// A dataflow-rs 4 trace as Orion 2 persists `task_trace_json`, recorded from
// `orion-server dry-run` over a two-sweep loop: a `map` with two mappings, a
// task its condition always skips, and a `db_read` that fails on sweep 1. The
// two steps with no task are the engine's own, writing the loop counter.
export const TRACE_V4 = {
  "initial": {
    "data": {
      "qty": 3
    },
    "metadata": {
      "processed_at": "2026-10-24T13:26:11.434998+00:00",
      "engine_version": "4.0.1"
    },
    "temp_data": {}
  },
  "steps": [
    {
      "workflow": 0,
      "workflow_id": "dry-run",
      "task": null,
      "task_id": null,
      "result": "executed",
      "status": null,
      "changes": [
        {
          "path": "temp_data.i",
          "old_value": null,
          "new_value": 0
        }
      ],
      "loop_counter": 0
    },
    {
      "workflow": 0,
      "workflow_id": "dry-run",
      "task": 0,
      "task_id": "shape",
      "result": "executed",
      "status": 200,
      "changes": [
        {
          "path": "data.order.total",
          "old_value": null,
          "new_value": 30
        },
        {
          "path": "temp_data.seen",
          "old_value": null,
          "new_value": 0
        },
        {
          "path": "metadata.progress",
          "old_value": null,
          "new_value": {
            "workflow_id": "dry-run",
            "task_id": "shape",
            "status_code": 200
          }
        }
      ],
      "mapping_ends": [
        1,
        2
      ],
      "elapsed_us": 92,
      "loop_counter": 0
    },
    {
      "workflow": 0,
      "workflow_id": "dry-run",
      "task": 1,
      "task_id": "never",
      "result": "skipped",
      "status": null,
      "changes": [],
      "loop_counter": 0
    },
    {
      "workflow": 0,
      "workflow_id": "dry-run",
      "task": 2,
      "task_id": "lookup",
      "result": "skipped",
      "status": null,
      "changes": [],
      "loop_counter": 0
    },
    {
      "workflow": 0,
      "workflow_id": "dry-run",
      "task": null,
      "task_id": null,
      "result": "executed",
      "status": null,
      "changes": [
        {
          "path": "temp_data.i",
          "old_value": 0,
          "new_value": 1
        }
      ],
      "loop_counter": 1
    },
    {
      "workflow": 0,
      "workflow_id": "dry-run",
      "task": 0,
      "task_id": "shape",
      "result": "executed",
      "status": 200,
      "changes": [
        {
          "path": "data.order.total",
          "old_value": 30,
          "new_value": 30
        },
        {
          "path": "temp_data.seen",
          "old_value": 0,
          "new_value": 1
        },
        {
          "path": "metadata.progress",
          "old_value": {
            "workflow_id": "dry-run",
            "task_id": "shape",
            "status_code": 200
          },
          "new_value": {
            "workflow_id": "dry-run",
            "task_id": "shape",
            "status_code": 200
          }
        }
      ],
      "mapping_ends": [
        1,
        2
      ],
      "elapsed_us": 6,
      "loop_counter": 1
    },
    {
      "workflow": 0,
      "workflow_id": "dry-run",
      "task": 1,
      "task_id": "never",
      "result": "skipped",
      "status": null,
      "changes": [],
      "loop_counter": 1
    },
    {
      "workflow": 0,
      "workflow_id": "dry-run",
      "task": 2,
      "task_id": "lookup",
      "result": "failed",
      "status": 500,
      "changes": [
        {
          "path": "metadata.progress",
          "old_value": {
            "workflow_id": "dry-run",
            "task_id": "shape",
            "status_code": 200
          },
          "new_value": {
            "workflow_id": "dry-run",
            "task_id": "lookup",
            "status_code": 500
          }
        },
        {
          "path": "metadata._orion_errors",
          "old_value": null,
          "new_value": [
            {
              "workflow_id": "dry-run",
              "task_id": "lookup",
              "code": "FUNCTION_ERROR",
              "status": 500
            }
          ]
        }
      ],
      "errors": [
        {
          "code": "FUNCTION_ERROR",
          "message": "Task lookup error: Function execution error: dry-run: no stub for 'db_read' on target 'orders'. Add it to the stubs file: {\"db_read\": {\"orders\": <response>}}",
          "path": null,
          "workflow_id": "dry-run",
          "task_id": "lookup",
          "timestamp": "2026-10-24T13:26:11.434998+00:00"
        }
      ],
      "elapsed_us": 44,
      "loop_counter": 1
    }
  ],
  "truncated": false
}
