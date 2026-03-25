## 1. Preserve inbound attachment payloads

- [ ] 1.1 Update message task creation in `src/lib/services/input-manager.ts` to retain `attachments`
- [ ] 1.2 Update message task creation in `src/lib/services/input-manager.ts` to retain `visionInputs`
- [ ] 1.3 Add tests proving inbound message tasks preserve attachment metadata

## 2. Extend sub-agent spawn payloads

- [ ] 2.1 Extend `spawn_subagent` input schema to accept optional `attachments`
- [ ] 2.2 Extend `spawn_subagent` input schema to accept optional `visionInputs`
- [ ] 2.3 Pass those fields through when creating child tasks
- [ ] 2.4 Add tests for parent-to-child attachment and vision-input propagation

## 3. Delivery-context propagation

- [ ] 3.1 Ensure sub-agent execution can resolve inherited delivery targets when surfacing files
- [ ] 3.2 Add tests for `send_file_to_chat` from sub-agent tasks using inherited delivery context

## 4. Verification

- [ ] 4.1 Run attachment, vision, and sub-agent lifecycle regression suites
- [ ] 4.2 Verify the OpenSpec artifacts remain aligned and implementation-ready
