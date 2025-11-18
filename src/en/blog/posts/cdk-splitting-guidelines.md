---
title: How to Split CDK Applications Effectively (Real Project Guidelines)
description: Lessons from running large AWS CDK programs—why we split stacks, how we manage deployment order, and the guardrails that keep 500+ resources maintainable.
tags:
  - AWS
  - CDK
  - IaC
  - DevOps
date: 2025-11-18
permalink: /en/blog/cdk-splitting-guidelines/
---

> **Summary**: Once a CDK app grows near the 500-resource CloudFormation cap, breaking it into focused stacks is mandatory. Use clear service boundaries, shared construct libraries, and explicit dependency graphs so `cdk deploy` becomes predictable. Pair that with environment-aware pipelines and drift detection to keep dozens of stacks moving in lockstep.

## Why splitting CDK apps matters

AWS CloudFormation enforces a hard limit of **500 resources per stack**. Large programs can hit that ceiling quickly—especially when you duplicate infrastructure across multiple AWS accounts and Regions. Even before you reach the limit, monolithic stacks slow down deployments and make blast radius hard to reason about.

In our government cloud migration, the initial goal was simple: “Ship everything from one CDK app.” Six months later, that app handled:

- Four independent pipelines (unit, integration, external-integration, production) pointed at the same monolithic stack, so every change meant duplicating approvals and shepherding four identical runs.
- Networking, security, compute, messaging, analytics—every shared platform concern—lived in one stack, making each `cdk diff` sprawling and risk-prone.
- At peak the template exceeded the 500-resource limit; because each environment consumed the same synthesized stack, the blast radius was immediate across all accounts.

Individual deploys were tolerable on their own, but coordinating four pipelines per change and untangling giant `cdk diff`s drained entire evenings. Splitting stacks restored sanity.

Key benefits of breaking apart your CDK app:

- **Faster iterations**: Small stacks deploy in minutes, enabling targeted rollbacks.
- **Clear ownership**: Teams own stacks aligned with the services they operate.
- **Safer permissions**: Least-privilege deployment roles are easier to enforce when stacks map to specific domains.
- **Surgical change sets**: CloudFormation renders readable diffs when stacks stay under ~200 resources.

### Understand how CDK counts resources

One surprise for first-time CDK teams is that **the resource count is not one-to-one with logical constructs**. CloudFormation stores each ingress and egress rule on a security group as a separate `AWS::EC2::SecurityGroupIngress` or `AWS::EC2::SecurityGroupEgress` resource. CDK reflects that: a single security group object with 30 inbound rules and 1 outbound rule is **32 resources**, not 1. When you add subnet route table associations, custom policies, or step function states, the total can grow even faster. Track these expansions in CI so you notice long before the stack hits the 500-resource ceiling.

## Foundational principles

When you design a multi-stack CDK architecture, start with three principles:

1. **Stable boundaries**: Use domain-driven splits (network, identity, data, app, observability) instead of arbitrary resource counts. Boundaries that reflect real ownership survive reorganizations.
2. **Shared constructs, isolated state**: Publish L2/L3 constructs in a reusable library, but keep state (for example, `Vpc`, `HostedZone`, `Bucket`) in dedicated stacks so you can control updates and retention.
3. **Explicit coupling**: Document dependencies in code and infrastructure pipelines. Cross-stack references, SSM parameters, or exported outputs should tell deployers exactly what must exist first.

## A reference stacking pattern

The table below shows a pattern that allowed us to scale to 25+ stacks without losing our minds.

| Layer | Example stacks | Purpose | Typical cadence |
| --- | --- | --- | --- |
| **Foundations** | `NetworkStack`, `SharedSecurityStack` | VPCs, routing, IAM guardrails, KMS keys | Monthly |
| **Platform services** | `ObservabilityStack`, `ArtifactStoreStack`, `MessagingStack` | Shared SNS/SQS, EventBridge, logging, S3 artifact buckets | Bi-weekly |
| **Domain workloads** | `PaymentsApiStack`, `IdentityServiceStack`, `BatchJobsStack` | App code, Lambda functions, ECS services, databases | Daily |
| **Edge & UX** | `PublicWebStack`, `CloudFrontStack` | CloudFront, WAF, Route 53 | Weekly |

This layout keeps high-churn application code separate from infrastructure that rarely changes.

## Cross-stack references without pain

CloudFormation exports work, but they create an implicit dependency on the exporting stack’s deployed state—which can block updates if you refactor.

Prefer these patterns instead:

- **CDK context outputs**: For identifiers that rarely change (such as VPC IDs), emit them to `cdk.context.json` during bootstrap and consume them via context lookups (`Vpc.fromLookup`).
- **SSM parameter registry**: Write critical values (for example, subnet IDs, security group IDs) to Parameter Store in a shared account. Downstream stacks read them at deploy time using `ssm.StringParameter.fromStringParameterName`.
- **Dedicated `SharedExportsStack`**: If you must use exports, isolate them in a single stack that almost never changes. Downstream stacks use `Fn.importValue`, keeping dependency radius small.
- **Event-driven handshakes**: For application-to-application coordination, prefer EventBridge buses or SNS topics over direct resource sharing. This reduces tight coupling across stacks.

## Deployment order that scales

Without orchestration, `cdk deploy` on dozens of stacks devolves into guesswork. These are the guardrails we implemented:

1. **Directed deployment graph**: Represent stack dependencies explicitly in code:
   ```ts
   const network = new NetworkStack(app, 'Network', { env });
   const shared = new SharedServicesStack(app, 'Shared', {
     env,
     vpc: network.vpc,
   });
   shared.addDependency(network);
   const payments = new PaymentsStack(app, 'Payments', {
     env,
     sharedResources: shared.outputs,
   });
   payments.addDependency(shared);
   ```
   CDK respects `addDependency`, so manual deploys follow the graph automatically.

2. **Environment matrix builds**: In CI/CD (GitHub Actions, CodePipeline, GitLab CI), treat each environment as a stage. Example matrix: `{ env: dev, stacks: [network, shared, payments] }` flowing into `{ env: prod, stacks: [...] }`. Block promotion unless every stack in the previous stage passes.

3. **Config-driven order**: Version control a manifest (YAML/JSON) that lists stacks per environment:
   ```yaml
   dev:
     - network
     - shared
     - payments
   prod:
     - network
     - shared
     - payments
   ```
   Deployment jobs consume the manifest, ensuring humans and automation match.

4. **Failure isolation**: Use `cdk deploy stackA stackB` rather than `cdk deploy "*"`. When a stack fails, downstream stacks are never started, keeping environments consistent.

5. **Drift detection**: Add a nightly job that runs `cdk diff` or `cloudformation detect-stack-drift` on long-lived stacks. This catches out-of-band changes before the next deploy surprises you.

## Handling shared artifacts and pipelines

Splitting stacks highlights the difference between source code ownership and infrastructure ownership. We used the following workflow:

- **Mono-repo with packages**: Keep application code and infrastructure definitions together, but create a `packages/infrastructure` workspace for shared constructs (`payments-service-stack`, `observability-stack`).
- **Semantic versioning for constructs**: Publish constructs to an internal npm repository (`@company/platform-network`). Application stacks pin versions, so breaking changes are intentional.
- **Pipeline per domain**: Each product team owns a pipeline that deploys *only* their stacks. A platform pipeline provisions shared layers (network, observability) and runs less frequently.
- **Change detection**: Use `git diff --name-only` to detect which stacks changed. If only application code updates, deploy the application stacks; skip foundations.

## Operational tips from the field

- **100-stack log platform reality**: In our logging estate we managed more than 100 stacks, most generated from the same CDK app. Each stack handled a slice of log ingestion (regional partitions, retention profiles, and analytics feeds). The pattern scaled because we kept the app itself single-sourced; only configuration changed per stack.
- **Isolate KMS stacks**: We carved KMS keys into their own CDK app. Deleting a key demands a seven-day wait, and cross-Region replicas inherit the source key ID. When a non-primary Region deploy failed, that replica ID was stuck unless we destroyed and redeploy primary key. Now we deploy main-Region keys first, verify them, and only then roll out the DR stack as a second pass.
- **Bootstrap once per account**: Ensure every AWS account uses the same CDK bootstrap template version. Mismatched bootstrap stacks create permissions issues when stacks assume roles across accounts.
- **Limit nested stacks**: CDK nested stacks help with organization, but they still count toward the 500-resource limit. Treat them as a tactical tool, not the core split mechanism.
- **Centralize tagging**: Apply mandatory tags (cost center, owner, data classification) via Aspect so every stack inherits them automatically.
- **Document outputs**: Store stack outputs in a lightweight docs site or README. When on-call engineers need a VPC endpoint ID at 3 a.m., they shouldn’t read CDK code.
- **Plan for rollback**: With many stacks, rollback means redeploying the previous version of a subset of stacks. Keep a manifest of the last known good stack versions per environment.

### Lean environment management with config files

Operating four environments (unit test, integration, external integration, production) does not require four separate CDK apps. Instead, we maintained **environment-specific configuration modules** (TypeScript `.ts` files) that stored dynamic values—account IDs, VPC CIDR blocks, feature toggles—and pointed stacks at the correct file by exporting an environment variable before deployment:

```bash
export NODE_ENV=prod
npx cdk deploy
```

The entry point read `process.env.NODE_ENV` (defaulting to `dev`) and loaded `config/prod.ts` or `config/dev.ts`. This kept the infrastructure code identical while letting us inject environment-specific details without copy-pasting apps. Promotion flows only switched the environment variable in CI/CD, ensuring the exact same templates rolled through dev → test → prod.

## Checklist before shipping a multi-stack CDK program

- [ ] Does every stack own a clear functional domain?
- [ ] Are there fewer than ~400 resources per stack (steady state)?
- [ ] Are cross-stack dependencies documented via `addDependency`, SSM, or context?
- [ ] Do CI/CD pipelines deploy stacks in a deterministic order per environment?
- [ ] Can you redeploy a single stack (or subset) without touching unrelated stacks?
- [ ] Are bootstrap roles, tagging standards, and logging consistent across stacks?
- [ ] Do on-call engineers know where to find stack outputs and deployment manifests?

Run through this list during architecture reviews and quarterly platform health checks. Splitting CDK apps is not just a workaround for the 500-resource limit—it is a strategy for building resilient, auditable infrastructure at scale.

---
