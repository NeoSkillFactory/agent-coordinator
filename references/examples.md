# Real-World Workflow Examples

Concrete, runnable examples for common multi-agent coordination scenarios.

---

## Example 1: Web Application Deployment Pipeline

Coordinates four specialised agents: code analyst, test runner, security scanner, and deployer.

### Config (`assets/example-workflows/deploy-webapp.json`)

```json
{
  "workflow": { "name": "deploy-webapp", "maxRetries": 3, "timeoutMs": 60000 },
  "agents": [
    { "id": "analyst",  "role": "analyst",  "capabilities": ["code-analysis", "linting"] },
    { "id": "tester",   "role": "tester",   "capabilities": ["unit-tests", "integration-tests"] },
    { "id": "security", "role": "security", "capabilities": ["vulnerability-scan", "dependency-audit"] },
    { "id": "deployer", "role": "deployer", "capabilities": ["deployment", "rollback"] }
  ],
  "tasks": [
    { "id": "lint",    "description": "Lint and static analysis",  "assignTo": "analyst",  "dependencies": [] },
    { "id": "test",    "description": "Run test suite",            "assignTo": "tester",   "dependencies": ["lint"] },
    { "id": "scan",    "description": "Security vulnerability scan","assignTo": "security", "dependencies": ["lint"] },
    { "id": "deploy",  "description": "Deploy to staging",         "assignTo": "deployer", "dependencies": ["test", "scan"] }
  ]
}
```

### Run

```bash
node scripts/cli.js start --config assets/example-workflows/deploy-webapp.json
```

### Expected output

```json
{
  "workflowId": "...",
  "status": "completed",
  "summary": "Workflow \"deploy-webapp\": 4/4 tasks completed (100.0% success rate) in 42ms",
  "completedTasks": 4,
  "failedTasks": 0
}
```

---

## Example 2: Data Processing Pipeline

Splits a large dataset across three parallel worker agents, then merges the results.

### Config

```json
{
  "workflow": { "name": "data-pipeline", "maxRetries": 2, "timeoutMs": 120000 },
  "agents": [
    { "id": "splitter",  "role": "splitter",  "capabilities": ["data-splitting"] },
    { "id": "worker-a",  "role": "processor", "capabilities": ["data-processing"] },
    { "id": "worker-b",  "role": "processor", "capabilities": ["data-processing"] },
    { "id": "worker-c",  "role": "processor", "capabilities": ["data-processing"] },
    { "id": "aggregator","role": "aggregator","capabilities": ["data-aggregation","reporting"] }
  ],
  "tasks": [
    { "id": "split",     "description": "Partition dataset into 3 chunks", "assignTo": "splitter",  "dependencies": [] },
    { "id": "process-a", "description": "Process partition A",             "assignTo": "worker-a",  "dependencies": ["split"] },
    { "id": "process-b", "description": "Process partition B",             "assignTo": "worker-b",  "dependencies": ["split"] },
    { "id": "process-c", "description": "Process partition C",             "assignTo": "worker-c",  "dependencies": ["split"] },
    { "id": "merge",     "description": "Aggregate and generate report",   "assignTo": "aggregator","dependencies": ["process-a","process-b","process-c"] }
  ]
}
```

---

## Example 3: AI-Assisted Code Review

Three review agents examine different aspects of a pull request, then a final agent synthesises findings.

### Programmatic usage

```javascript
const { AgentCoordinator } = require('./scripts/agent-coordinator');

const coordinator = new AgentCoordinator({ maxRetries: 2, timeoutMs: 45000 });

coordinator.registerAgent({ id: 'style-reviewer',    role: 'reviewer', capabilities: ['style', 'formatting'] });
coordinator.registerAgent({ id: 'logic-reviewer',    role: 'reviewer', capabilities: ['logic', 'correctness'] });
coordinator.registerAgent({ id: 'security-reviewer', role: 'reviewer', capabilities: ['security', 'injection'] });
coordinator.registerAgent({ id: 'synthesiser',       role: 'lead',     capabilities: ['summarisation'] });

const workflow = coordinator.createWorkflow({
  name: 'code-review-pr-42',
  tasks: [
    { id: 'style-check',    description: 'Check code style and formatting', assignTo: 'style-reviewer',    dependencies: [] },
    { id: 'logic-check',    description: 'Review business logic',           assignTo: 'logic-reviewer',    dependencies: [] },
    { id: 'security-check', description: 'Audit for security issues',       assignTo: 'security-reviewer', dependencies: [] },
    { id: 'synthesise',     description: 'Summarise review findings',       assignTo: 'synthesiser',       dependencies: ['style-check','logic-check','security-check'] },
  ],
});

const result = await coordinator.runWorkflow(workflow.id);
console.log(result.summary);
```

---

## Example 4: DevOps Automation

Automates infrastructure provisioning, configuration, and health verification.

```json
{
  "workflow": { "name": "devops-automation", "maxRetries": 3, "timeoutMs": 300000 },
  "agents": [
    { "id": "provisioner", "role": "infra",   "capabilities": ["terraform", "cloudformation"] },
    { "id": "configurator","role": "config",  "capabilities": ["ansible", "chef"] },
    { "id": "verifier",    "role": "qa",      "capabilities": ["health-check", "smoke-test"] },
    { "id": "notifier",    "role": "comms",   "capabilities": ["slack", "pagerduty"] }
  ],
  "tasks": [
    { "id": "provision",  "description": "Provision cloud resources",   "assignTo": "provisioner",  "dependencies": [] },
    { "id": "configure",  "description": "Configure application stack", "assignTo": "configurator", "dependencies": ["provision"] },
    { "id": "verify",     "description": "Run health checks",           "assignTo": "verifier",     "dependencies": ["configure"] },
    { "id": "notify",     "description": "Send deployment notification","assignTo": "notifier",     "dependencies": ["verify"] }
  ]
}
```

---

## Troubleshooting Common Scenarios

### Workflow stalls at a single task

1. Run `node scripts/cli.js status --workflow <id>` to identify the blocked task.
2. Check the assigned agent's `status` field (should be `idle` after task finishes).
3. Increase `timeoutMs` if the task legitimately takes longer.
4. Check for deadlocks in the dependency graph with `workflowManager.getDependencyTree(workflowId)`.

### Agent not available

Ensure the agent is registered before `runWorkflow` is called. Agents must be registered via `coordinator.registerAgent()` or listed in the config's `agents` array.

### All retries exhausted

Set `maxRetries` higher in the config, or fix the underlying agent issue. Check the `error` field in the failed task entry for the root cause.
