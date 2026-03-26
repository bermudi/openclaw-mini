## 1. Canonical Cron Utility

- [ ] 1.1 Implement shared cron utility used by both InputManager and scheduler
- [ ] 1.2 Remove duplicate ad-hoc cron date calculation paths
- [ ] 1.3 Ensure one parser library is used consistently

## 2. Validation at Boundaries

- [ ] 2.1 Validate cron expressions when creating a trigger
- [ ] 2.2 Validate cron expressions when updating a trigger
- [ ] 2.3 Return clear validation errors for invalid expressions

## 3. Scheduling Behavior

- [ ] 3.1 Calculate `nextRunAt` from cron expression + reference time
- [ ] 3.2 Preserve behavior across process restarts (recompute from stored expression)
- [ ] 3.3 Define timezone policy (default UTC unless explicitly configured)

## 4. Testing

- [ ] 4.1 Add unit tests for hourly/daily/weekly cron expressions
- [ ] 4.2 Add unit test for invalid cron expression rejection
- [ ] 4.3 Add integration test proving due cron triggers enqueue expected tasks
