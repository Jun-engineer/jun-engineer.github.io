---
title: "ECS Health Check Grace Period: Coordinating ALB, Target Group, and Container Health Checks"
description: How the ECS health check grace period interacts with ALB target group settings, health check ports, and container health checks—and why misconfiguring any one of them causes premature task kills.
tags:
  - AWS
  - ECS
  - Load Balancing
  - DevOps
  - Reliability
date: 2026-03-30
permalink: /en/blog/ecs-health-check-grace-period/
category: Operations
duration: 8 min read
cta: Read the deep dive
---

> **Summary**: When ECS tasks register with an ALB target group, three independent health check layers decide whether to keep or kill them. The ECS health check grace period buys startup time, but only if the ALB health check interval, thresholds, and port are aligned. Misconfigure one layer and tasks enter a restart loop before they ever serve traffic.

## The Problem: Tasks Killed Before They Are Ready

You deploy a new ECS service behind an Application Load Balancer. The container takes 30 seconds to boot, but within 20 seconds ECS has already marked the task unhealthy and started a replacement. The replacement suffers the same fate. Your service oscillates between RUNNING and DRAINING, never reaching steady state.

This happens because three health check mechanisms fire independently, and ECS acts on the first failure it sees:

1. **ALB target group health check** — the load balancer probes each registered target at a configurable interval.
2. **ECS service health check** — the ECS scheduler evaluates whether tasks behind a load balancer are healthy.
3. **Container health check** — an optional `HEALTHCHECK` in the Dockerfile or `healthCheck` in the task definition.

The **health check grace period** is the ECS setting that pauses evaluation of these signals during startup. Understanding how all three layers interact is critical to avoiding the restart loop.

## Layer 1: ALB Target Group Health Check

When an ECS task registers with a target group, the ALB starts sending health check probes to the task. These settings live on the **target group**, not on the ALB listener.

### Key parameters

<div class="table-scroll">

| Parameter | Default | Recommended starting point | Description |
| --- | --- | --- | --- |
| **Protocol** | HTTP | HTTP or HTTPS | Protocol used for the health check request |
| **Path** | `/` | `/health` or `/healthz` | The endpoint the ALB hits |
| **Port** | `traffic-port` | `traffic-port` | Which port the ALB probes (see next section) |
| **Interval** | 30s | 10–30s | Time between probes per target |
| **Timeout** | 5s | 5s | How long the ALB waits for a response |
| **Healthy threshold** | 5 | 2–3 | Consecutive successes to mark healthy |
| **Unhealthy threshold** | 2 | 2–3 | Consecutive failures to mark unhealthy |
| **Success codes** | 200 | 200–299 | HTTP status code(s) regarded as healthy |

</div>

### How long until a target is marked healthy?

The formula is:

$$T_{healthy} = Interval \times Healthy\ Threshold$$

With defaults (30s interval × 5 threshold), a target needs **150 seconds** of successful probes before the ALB considers it healthy and starts routing real traffic. Lowering the healthy threshold to 2 with a 10-second interval brings this down to **20 seconds**.

### How long until a target is marked unhealthy?

$$T_{unhealthy} = Interval \times Unhealthy\ Threshold$$

With defaults (30s × 2), a misbehaving target is pulled from rotation after **60 seconds**. During this window, the ALB continues sending real traffic to the failing target.

## Layer 2: Health Check Port — A Common Source of Confusion

The **health check port** determines _where_ the ALB sends its probe. There are three options:

1. **`traffic-port`** (default) — the ALB probes the same port that receives application traffic. This is the simplest and most common choice.
2. **A specific port number** — useful when your container exposes a dedicated health endpoint on a different port (for example, a sidecar or management port).
3. **Override port** — when the container listens on multiple ports and you want the health check to target a non-primary one.

### When to use a dedicated health check port

- Your application has a lightweight `/health` endpoint on port 8081 while serving traffic on port 443/8080.
- A sidecar container (for example, Envoy) handles the health check on behalf of the main application.
- You want health checks to bypass middleware (authentication, rate limiting) that sits on the traffic port.

### Pitfall: port mismatch with ECS dynamic port mapping

If you use **dynamic port mapping** (where ECS assigns a random host port), the target group automatically discovers the mapped port via the ECS integration. Setting a hard-coded health check port in this case breaks probes, because the ALB sends the check to the wrong port. Always use `traffic-port` with dynamic port mapping unless you have a specific override need.

## Layer 3: ECS Health Check Grace Period

The `healthCheckGracePeriodSeconds` is set on the **ECS service** (not the task definition, not the target group). It tells the ECS scheduler:

> "After a task enters RUNNING state and registers with the load balancer, ignore all health check failures for this many seconds."

During the grace period:
- ALB health check failures do **not** cause ECS to replace the task.
- Container `HEALTHCHECK` failures are also ignored by ECS.
- The ALB still tracks the target's health internally — it just will not route traffic to an unhealthy target.

### What happens when the grace period expires?

Once the grace period ends, ECS begins evaluating health signals normally. If the ALB still reports the target as unhealthy at that point, ECS drains and replaces the task immediately.

This is where misconfiguration causes restart loops:

$$Grace\ Period < T_{healthy} \Rightarrow \text{Task killed before ALB marks it healthy}$$

If your grace period is 30 seconds but the ALB needs 150 seconds (default settings) to mark the target healthy, ECS will always kill the task before it receives any real traffic.

### Recommended formula

Set the grace period to at least:

$$Grace\ Period \geq (Interval \times Healthy\ Threshold) + Container\ Boot\ Time + Buffer$$

For example, if your container takes 20 seconds to boot, the ALB interval is 10 seconds, and the healthy threshold is 3:

$$Grace\ Period \geq (10 \times 3) + 20 + 10 = 60\ seconds$$

A conservative value like **60–120 seconds** works for most web services. Applications with database migrations or cache warming at startup may need 180–300 seconds.

## Layer 4 (Optional): Container Health Check

The Docker `HEALTHCHECK` instruction or the ECS task definition `healthCheck` block runs a command inside the container at a configured interval. If the command fails for the specified retries, Docker marks the container as `UNHEALTHY`.

```json
{
  "healthCheck": {
    "command": ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
    "interval": 15,
    "timeout": 5,
    "retries": 3,
    "startPeriod": 30
  }
}
```

### The `startPeriod` matters

The `startPeriod` is the container-level equivalent of the ECS grace period. During this window, health check failures do not count toward the retry limit. Set it long enough for your application to complete initialization.

> **Important**: The ECS health check grace period and the container `startPeriod` are independent. ECS evaluates both signals. If your grace period is 60 seconds but `startPeriod` is 0, a slow-starting container may be marked `UNHEALTHY` by Docker before ECS even looks at the ALB status.

## Putting It All Together

Here is a configuration that keeps the three layers in harmony for a typical web application that takes ~15 seconds to boot:

### Target group health check

```
Protocol:            HTTP
Path:                /health
Port:                traffic-port
Interval:            10 seconds
Timeout:             5 seconds
Healthy threshold:   3
Unhealthy threshold: 3
Success codes:       200
```

Time to healthy: 10 × 3 = **30 seconds**

### ECS service

```
healthCheckGracePeriodSeconds: 60
```

Grace period (60s) > time to healthy (30s) + boot time (15s) = 45s ✓

### Container health check (task definition)

```json
{
  "command": ["CMD-SHELL", "curl -f http://localhost:8080/health || exit 1"],
  "interval": 10,
  "timeout": 5,
  "retries": 3,
  "startPeriod": 45
}
```

Start period (45s) > boot time (15s), retries tolerate transient failures during startup ✓

## Common Mistakes and How to Fix Them

### 1. Grace period too short

**Symptom**: Tasks cycle between RUNNING → DRAINING → RUNNING. ECS events show `service X has reached a steady state` never appearing.

**Fix**: Increase `healthCheckGracePeriodSeconds` so it exceeds `(Interval × Healthy Threshold) + boot time`.

### 2. Healthy threshold too high with long interval

**Symptom**: Deployments take 5+ minutes as ECS waits for the ALB to mark new targets healthy.

**Fix**: Lower the healthy threshold to 2 and shorten the interval to 10 seconds.

### 3. Health check path returns 3XX or 401

**Symptom**: ALB marks all targets unhealthy even though the application is running.

**Fix**: Ensure the health check path returns a `200` response without requiring authentication, redirects, or CORS headers.

### 4. Wrong health check port with dynamic port mapping

**Symptom**: ALB health checks time out; all targets stuck in `initial` state.

**Fix**: Set the health check port to `traffic-port` instead of a hard-coded port number.

### 5. No container startPeriod

**Symptom**: Container marked `UNHEALTHY` by Docker during boot, causing ECS to replace it even when the grace period has not expired.

**Fix**: Set `startPeriod` in the container health check to cover boot time.

## Debugging Checklist

When tasks keep cycling, work through these in order:

- [ ] Check ECS service events for `has started 1 tasks` / `has begun draining connections` patterns.
- [ ] Verify `healthCheckGracePeriodSeconds` on the ECS service is large enough.
- [ ] Inspect the target group's health check configuration (path, port, interval, thresholds).
- [ ] Confirm the health endpoint returns `200` locally (`curl http://localhost:PORT/health`).
- [ ] If using a container health check, verify `startPeriod` covers boot time.
- [ ] Check CloudWatch for `HealthyHostCount` and `UnHealthyHostCount` on the target group — if both are 0, the target was never registered.
- [ ] Look at `TargetResponseTime` and `HTTPCode_Target_5XX_Count` to distinguish between slow startup and application errors.

## Takeaways

- The ECS health check grace period, ALB target group health check, and container `HEALTHCHECK` are three independent systems. All three must be aligned.
- Always set the grace period longer than `(ALB interval × healthy threshold) + container boot time`.
- Use `traffic-port` for ALB health checks unless you have a deliberate reason to probe a different port.
- Set `startPeriod` on container health checks to avoid false positives during initialization.
- When debugging restart loops, check ECS service events and target group health status in parallel — the root cause often sits in the gap between the two.
