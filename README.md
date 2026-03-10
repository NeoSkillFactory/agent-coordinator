# agent-coordinator

![Audit](https://img.shields.io/badge/audit%3A%20PASS-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue) ![OpenClaw](https://img.shields.io/badge/OpenClaw-skill-orange)

> Coordinates multiple AI agents to collaborate on complex tasks with seamless communication and task delegation

## Features

- Manage agent-to-agent communication and message routing between OpenClaw sessions
- Delegate subtasks between specialized agents based on expertise and availability
- Orchestrate multi-agent workflows with dependency management and task sequencing
- Handle agent failures and retry strategies with graceful error recovery
- Provide real-time status monitoring and logging of coordinated agent activities
- Generate comprehensive workflow summaries and performance metrics

## Configuration

```json
{
  "workflow": {
    "name": "my-workflow",
    "maxRetries": 3,
    "timeoutMs": 30000
  },
  "agents": [
    {
      "id": "agent-1",
      "role": "analyst",
      "capabilities": ["code-analysis", "testing"]
    }
  ],
  "tasks": [
    {
      "id": "task-1",
      "description": "Analyze codebase",
      "assignTo": "agent-1",
      "dependencies": []
    }
  ]
}
```

## GitHub

Source code: [github.com/NeoSkillFactory/agent-coordinator](https://github.com/NeoSkillFactory/agent-coordinator)

## License

MIT © NeoSkillFactory