# `/plan` API JSON Structure Documentation

## Endpoint
`POST /api/nutjs/plan`

## Authentication
Requires API key authentication via the `authenticate` middleware.

---

## Request Structure

### Basic Request
```json
{
  "command": "Generate Mickey Mouse images in ChatGPT, Grok and Perplexity",
  "intent": "command_automate",
  "context": {
    "screenIntel": {},
    "activeApp": "Google Chrome",
    "activeUrl": "https://chat.openai.com",
    "history": {}
  }
}
```

### Request with Replanning (Feedback)
```json
{
  "command": "Generate Mickey Mouse images in ChatGPT, Grok and Perplexity",
  "intent": "command_automate",
  "context": {
    "screenIntel": {},
    "activeApp": "Google Chrome",
    "activeUrl": "https://chat.openai.com"
  },
  "previousPlan": {
    "planId": "uuid-of-previous-plan",
    "version": 1,
    "steps": []
  },
  "feedback": {
    "reason": "failure",
    "message": "Perplexity login failed, use ChatGPT and Grok only",
    "stepId": "step_5"
  }
}
```

### Request with Clarification Answers
```json
{
  "command": "Book a flight to Paris",
  "intent": "command_automate",
  "clarificationAnswers": [
    {
      "questionId": "q1",
      "answer": "December 15th"
    },
    {
      "questionId": "q2",
      "answer": "Economy class"
    }
  ]
}
```

---

## Request Fields

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `command` | `string` | Natural language command describing the automation task |

### Optional Fields

| Field | Type | Description |
|-------|------|-------------|
| `intent` | `string` | Intent type: `"command_automate"` or `"command_guide"`. Defaults to `"command_automate"` |
| `context` | `object` | Context information for plan generation |
| `context.screenIntel` | `object` | OCR snapshot from screen-intel MCP |
| `context.activeApp` | `string` | Currently active application name |
| `context.activeUrl` | `string` | Currently active URL (if browser) |
| `context.history` | `object` | Historical context data |
| `previousPlan` | `object` | Previous plan object for replanning scenarios |
| `feedback` | `object` | User feedback for replanning |
| `feedback.reason` | `string` | Reason for replanning: `"clarification"`, `"failure"`, or `"scope_change"` |
| `feedback.message` | `string` | Detailed feedback message |
| `feedback.stepId` | `string` | ID of the step that triggered feedback |
| `clarificationAnswers` | `array` | Answers to clarification questions from a previous plan |

---

## Response Structure

### Success Response (200)
```json
{
  "success": true,
  "plan": {
    "planId": "uuid-generated-plan-id",
    "version": 1,
    "intent": "command_automate",
    "goal": "Generate Mickey Mouse images in ChatGPT, Grok and Perplexity",
    "steps": [
      {
        "id": "step_1",
        "kind": {
          "type": "focusApp",
          "appName": "Google Chrome"
        },
        "description": "Focus browser",
        "status": "pending",
        "retry": {
          "maxAttempts": 2,
          "delayMs": 1000
        },
        "onError": {
          "strategy": "fail_plan"
        }
      },
      {
        "id": "step_2",
        "kind": {
          "type": "navigate",
          "url": "https://chat.openai.com"
        },
        "description": "Navigate to ChatGPT",
        "status": "pending",
        "retry": {
          "maxAttempts": 3,
          "delayMs": 2000
        },
        "onError": {
          "strategy": "retry_then_skip"
        }
      }
    ],
    "questions": [],
    "metadata": {
      "createdAt": "2024-12-11T20:16:00.000Z",
      "estimatedDuration": "2-3 minutes"
    }
  },
  "provider": "grok",
  "latencyMs": 1234
}
```

### Success Response with Clarification Questions
```json
{
  "success": true,
  "needsClarification": true,
  "clarificationQuestions": [
    {
      "id": "q1",
      "question": "What date would you like to travel?",
      "type": "text"
    },
    {
      "id": "q2",
      "question": "Which class would you prefer?",
      "type": "choice",
      "options": ["Economy", "Business", "First Class"]
    }
  ],
  "plan": null,
  "provider": "grok",
  "latencyMs": 856
}
```

### Error Response (400 - Bad Request)
```json
{
  "success": false,
  "error": "Missing or invalid \"command\" parameter. Please provide a natural language command.",
  "example": {
    "command": "Generate Mickey Mouse images in ChatGPT, Grok and Perplexity",
    "intent": "command_automate",
    "context": {
      "screenIntel": {},
      "activeApp": "Google Chrome",
      "activeUrl": "https://chat.openai.com"
    }
  }
}
```

### Error Response (500 - Server Error)
```json
{
  "success": false,
  "error": "Failed to generate automation plan",
  "message": "Detailed error message"
}
```

---

## Response Fields

### Success Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Always `true` for successful responses |
| `plan` | `object` or `null` | Generated automation plan (null if clarification needed) |
| `plan.planId` | `string` | Unique identifier for the plan (UUID) |
| `plan.version` | `number` | Plan version number (increments with replanning) |
| `plan.intent` | `string` | Intent type: `"command_automate"` or `"command_guide"` |
| `plan.goal` | `string` | High-level description of the automation goal |
| `plan.steps` | `array` | Array of step objects defining the automation sequence |
| `plan.questions` | `array` | Optional clarifying questions (legacy field) |
| `plan.metadata` | `object` | Additional metadata about the plan |
| `provider` | `string` | AI provider used: `"grok"` or `"claude"` |
| `latencyMs` | `number` | Time taken to generate the plan in milliseconds |
| `needsClarification` | `boolean` | Whether clarification is needed before execution |
| `clarificationQuestions` | `array` | Array of clarification question objects |

### Step Object Structure

Each step in `plan.steps` has the following structure:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique step identifier (e.g., `"step_1"`) |
| `kind` | `object` | Step type and parameters |
| `kind.type` | `string` | Step type (e.g., `"focusApp"`, `"navigate"`, `"click"`, `"type"`) |
| `description` | `string` | Human-readable description of the step |
| `status` | `string` | Execution status: `"pending"`, `"running"`, `"completed"`, `"failed"` |
| `retry` | `object` | Retry configuration |
| `retry.maxAttempts` | `number` | Maximum retry attempts |
| `retry.delayMs` | `number` | Delay between retries in milliseconds |
| `onError` | `object` | Error handling strategy |
| `onError.strategy` | `string` | Strategy: `"fail_plan"`, `"retry_then_skip"`, `"skip"` |

### Common Step Types

- **`focusApp`**: Focus an application
  ```json
  { "type": "focusApp", "appName": "Google Chrome" }
  ```

- **`navigate`**: Navigate to a URL
  ```json
  { "type": "navigate", "url": "https://example.com" }
  ```

- **`click`**: Click at coordinates or element
  ```json
  { "type": "click", "x": 100, "y": 200 }
  ```

- **`type`**: Type text
  ```json
  { "type": "type", "text": "Hello World" }
  ```

- **`wait`**: Wait for duration
  ```json
  { "type": "wait", "durationMs": 1000 }
  ```

---

## Usage Examples

### Example 1: Basic Automation Plan
```bash
curl -X POST http://localhost:3000/api/nutjs/plan \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "command": "Open Spotify and play my Discover Weekly playlist"
  }'
```

### Example 2: Context-Aware Plan
```bash
curl -X POST http://localhost:3000/api/nutjs/plan \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "command": "Search for winter jackets",
    "intent": "command_automate",
    "context": {
      "activeApp": "Google Chrome",
      "activeUrl": "https://amazon.com"
    }
  }'
```

### Example 3: Replanning with Feedback
```bash
curl -X POST http://localhost:3000/api/nutjs/plan \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "command": "Generate images in ChatGPT and Grok",
    "previousPlan": {
      "planId": "abc-123",
      "version": 1,
      "steps": []
    },
    "feedback": {
      "reason": "failure",
      "message": "ChatGPT login failed, skip it",
      "stepId": "step_3"
    }
  }'
```

---

## Notes

- The endpoint supports **adaptive replanning** through the `previousPlan` and `feedback` fields
- Plans can include **clarification questions** that need to be answered before execution
- The `version` field increments with each replan iteration
- Error handling strategies are configurable per step
- The AI provider (`grok` or `claude`) is automatically selected based on availability
