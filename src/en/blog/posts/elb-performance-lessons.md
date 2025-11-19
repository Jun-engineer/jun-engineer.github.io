---
title: Tuning Elastic Load Balancer Performance Under Heavy Load
description: Lessons learned from stabilizing Application and Network Load Balancers during peak traffic, including scaling safely across multiple ALBs and mitigating noisy neighbor effects on NLBs.
tags:
  - AWS
  - Load Balancing
  - DevOps
  - Performance
  - Reliability
date: 2025-11-19
permalink: /en/blog/elb-performance-lessons/
---

> **Summary**: Sudden ALB scale-out can drop targets if connection draining and lifecycle hooks are not tuned. We solved repeated 50X bursts by sharding traffic across 10+ ALBs behind Route 53 and treating each shard as an independent failure domain. For NLB, noisy neighbors still share hardware; exponential backoff on 443 connections is the only practical shield when AWS cannot relocate your load balancer immediately.

## Why We Looked Beyond Default ELB Settings

A large-scale performance test pushed both our Application Load Balancer (ALB) and Network Load Balancer (NLB) to their limits. Despite using standard AWS defaults, we hit two failure modes:

- ALB scale-out caused target deregistration, delivering 50X errors mid-test.
- NLB capacity contention with unknown tenants introduced repeated 443 TLS timeouts.

This article walks through the symptoms, the instrumentation we relied on, and the mitigations that kept production traffic flowing.

## Failure Mode 1: ALB Scale-Out Dropped Targets

### What Happened

Under peak traffic the ALB decided to scale out. During the scale event AWS recycled ENIs and briefly removed our ECS tasks from the target group. Because the deregistration grace period was still using the 300-second default and draining did not finish in time, active requests fell into the void and surfaced as 50X responses. Our autoscaling policy then ramped even harder, compounding the churn.

### The Mitigation Strategy

1. **Shard by ALB**: We provisioned more than 10 identical ALBs and used Route 53 weighted routing to distribute traffic evenly. Each shard now carries a smaller blast radius.
2. **Pin Target Groups to a Single ALB**: Every ALB received its own target group pair (HTTP/HTTPS). ECS services registered with exactly one group to avoid cross-ALB surprises.
3. **Tune Grace Periods**: We increased deregistration delay to 900 seconds and aligned ECS health checks with the same window so connections drain before scale-in/out transitions.
4. **Health Check SLOs**: We dropped health check timeout to 5 seconds with 2 consecutive failures so unhealthy containers exit rotation faster, limiting cascading retries.

### Observability Checklist

- Standard ALB metrics (`RequestCount`, `HTTPCode_Target_5XX_Count`, `TargetResponseTime`).
- AWS CloudTrail for `RegisterTargets` and `DeregisterTargets` calls during scale events.
- ECS service events for `service ... has begun draining connections` messages.

## Failure Mode 2: NLB Noisy Neighbor on Port 443

### What Happened

Our NLB shares underlying infrastructure with other tenants. During the performance test, another customer on the same hardware exhausted connection processing capacity, and our TLS listener on port 443 started returning connection timeout errors. AWS support acknowledged it as a noisy neighbor issue; there was no immediate relocation path.

### The Mitigation Strategy

1. **Client-Side Exponential Backoff**: We instrumented the application’s HTTPS client with jittered exponential backoff. The first retry waits 100 ms, doubling up to 3 seconds with full jitter to prevent lockstep retry storms.
2. **Differentiated Timeouts**: TLS handshake timeout was set to 2 seconds while read timeouts remained longer, so the application fails fast on connection pressure.
3. **Retry Visibility**: Custom metrics record retry counts and latency buckets so we can correlate backoff behavior with customer-facing errors.

### What Won’t Work

- **Force Scaling the NLB**: NLBs do not expose manual scale knobs; additional subnets or cross-zone balancing do not resolve noisy neighbor contention.
- **Dedicated Hardware Migration**: AWS does not offer instant migration of an NLB to dedicated hardware; retries remain the only practical stopgap.

## Architecture Overview

```
Route 53 (weighted records)
  ├─ ALB shard 1 ─ target group A ─ ECS service payments
  ├─ ALB shard 2 ─ target group B ─ ECS service payments
  └─ ...

NLB ─ TLS 443 listener ─ target group TLS ─ ECS service edge-proxy
```

- Each ALB shard carries an identical rule set and WAF association.
- Weighted routing is monitored with Route 53 health checks; unhealthy ALBs drop out automatically.
- ECS services export standard `ECS_CONTAINER_METADATA_URI_V4` metrics so we can correlate container restarts with load balancer events.

## Operational Guardrails

- **Load Test Playbook**: Document the validation steps (Route 53 weighting, cache priming, autoscaling alarms) and rehearse them before each peak event.
- **Error Budget Policy**: Invest in mitigation work (retry libraries, graceful shutdown) when ELB 50X or timeout errors consume more than 20% of the monthly error budget.
- **Chaos Scenarios**: Regularly simulate deregistration events by draining random tasks to confirm the retry logic and backoff behave as expected.

## Takeaways

- ALB scale-out can be disruptive; isolate workloads with multiple ALBs and aligned draining settings.
- NLB noisy neighbors are unavoidable without AWS intervention; robust retry logic and jitter are your best defense.
- Observability and rehearsed playbooks keep engineers ahead of customer-impacting incidents.

Use these lessons to prepare your own ELB stacks for stress tests before the next peak season arrives.
