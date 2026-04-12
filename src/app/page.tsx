import {
  createAgentAction,
  createTriggerAction,
  deleteAgentAction,
  deleteTriggerAction,
  saveWorkspaceAction,
  sendMessageAction,
  setDefaultAgentAction,
  toggleAgentAction,
  toggleTriggerAction,
} from '@/app/operator-actions';
import { loadOperatorSnapshot } from '@/lib/operator-console';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function formatDate(value?: Date): string {
  if (!value) {
    return 'Never';
  }

  return value.toLocaleString();
}

function readSearchParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export default async function RuntimeHomePage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const params = searchParams ? await searchParams : {};
  const selectedWorkspace = readSearchParam(params, 'workspace');
  const notice = readSearchParam(params, 'notice');
  const level = readSearchParam(params, 'level') === 'error' ? 'error' : 'success';
  const snapshot = await loadOperatorSnapshot(selectedWorkspace);

  return (
    <main className="shell">
      <div className="container">
        <section className="hero">
          <p className="eyebrow">Boundary Reset</p>
          <h1>OpenClaw Operator Console</h1>
          <p>
            The browser shell now runs in the root app and reads the runtime state directly on the server.
            The old standalone dashboard is no longer part of the default dev loop.
          </p>
          <div className="hero-actions">
            <a className="button" href="/">
              Refresh Console
            </a>
            <a className="ghost-button" href="/api/route">
              Internal API Surface
            </a>
          </div>
        </section>

        {notice ? <div className={`notice ${level}`}>{notice}</div> : null}

        <section className="metrics">
          <div className="metric">
            <span className="metric-label">Agents</span>
            <strong className="metric-value">{snapshot.agents.length}</strong>
          </div>
          <div className="metric">
            <span className="metric-label">Pending Tasks</span>
            <strong className="metric-value">{snapshot.taskStats.pending}</strong>
          </div>
          <div className="metric">
            <span className="metric-label">Sessions</span>
            <strong className="metric-value">{snapshot.sessions.length}</strong>
          </div>
          <div className="metric">
            <span className="metric-label">Triggers</span>
            <strong className="metric-value">{snapshot.triggers.length}</strong>
          </div>
        </section>

        <div className="grid">
          <div className="stack">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Agents</h2>
                  <p className="section-copy">Create, disable, delete, and message agents without crossing the browser/runtime boundary.</p>
                </div>
              </div>

              <form action={createAgentAction} className="form-grid">
                <div className="field">
                  <label htmlFor="agent-name">Name</label>
                  <input id="agent-name" name="name" placeholder="Support agent" required />
                </div>
                <div className="field">
                  <label htmlFor="agent-description">Description</label>
                  <input id="agent-description" name="description" placeholder="Handles operator requests" />
                </div>
                <div className="field">
                  <label htmlFor="agent-skills">Skills</label>
                  <input id="agent-skills" name="skills" placeholder="calendar, triage, notes" />
                </div>
                <div className="actions">
                  <button className="button" type="submit">Create Agent</button>
                </div>
              </form>

              <div className="card-list" style={{ marginTop: '1rem' }}>
                {snapshot.agents.length === 0 ? <p className="empty">No agents yet.</p> : null}
                {snapshot.agents.map((agent) => (
                  <article className="card" key={agent.id}>
                    <div className="card-header">
                      <div>
                        <h3>{agent.name}</h3>
                        <p className="muted">{agent.description ?? 'No description set.'}</p>
                        <div className="pills">
                          <span className={`pill ${agent.status}`}>{agent.status}</span>
                          {agent.isDefault ? <span className="pill default">default</span> : null}
                          {agent.skills.map((skill) => (
                            <span className="pill" key={skill}>{skill}</span>
                          ))}
                        </div>
                      </div>
                      <div className="actions">
                        {!agent.isDefault ? (
                          <form action={setDefaultAgentAction}>
                            <input name="agentId" type="hidden" value={agent.id} />
                            <button className="secondary-button" type="submit">Make Default</button>
                          </form>
                        ) : null}
                        <form action={toggleAgentAction}>
                          <input name="agentId" type="hidden" value={agent.id} />
                          <button className="ghost-button" type="submit">
                            {agent.status === 'disabled' ? 'Enable' : 'Disable'}
                          </button>
                        </form>
                        <form action={deleteAgentAction}>
                          <input name="agentId" type="hidden" value={agent.id} />
                          <button className="danger-button" type="submit">Delete</button>
                        </form>
                      </div>
                    </div>

                    <details style={{ marginTop: '0.9rem' }}>
                      <summary>Queue a test message</summary>
                      <form action={sendMessageAction} className="form-grid" style={{ marginTop: '0.85rem' }}>
                        <input name="agentId" type="hidden" value={agent.id} />
                        <div className="field">
                          <label htmlFor={`channel-${agent.id}`}>Channel</label>
                          <select defaultValue="webchat" id={`channel-${agent.id}`} name="channel">
                            <option value="webchat">webchat</option>
                            <option value="slack">slack</option>
                            <option value="telegram">telegram</option>
                            <option value="whatsapp">whatsapp</option>
                            <option value="discord">discord</option>
                            <option value="imessage">imessage</option>
                          </select>
                        </div>
                        <div className="field" style={{ gridColumn: '1 / -1' }}>
                          <label htmlFor={`content-${agent.id}`}>Message</label>
                          <textarea id={`content-${agent.id}`} name="content" placeholder="Summarize the overnight errors and suggest the next fix." required />
                        </div>
                        <div className="actions">
                          <button className="button" type="submit">Queue Message</button>
                        </div>
                      </form>
                    </details>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Recent Tasks</h2>
                  <p className="section-copy">Latest queue activity across the runtime.</p>
                </div>
                <div className="inline-list metadata">
                  <span>processing {snapshot.taskStats.processing}</span>
                  <span>completed {snapshot.taskStats.completed}</span>
                  <span>failed {snapshot.taskStats.failed}</span>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Source</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.tasks.length === 0 ? (
                      <tr>
                        <td className="empty" colSpan={5}>No tasks yet.</td>
                      </tr>
                    ) : null}
                    {snapshot.tasks.map((task) => {
                      const agent = snapshot.agents.find((entry) => entry.id === task.agentId);
                      return (
                        <tr key={task.id}>
                          <td>
                            <div>{agent?.name ?? task.agentId}</div>
                            <div className="metadata mono">{task.id}</div>
                          </td>
                          <td><span className={`pill ${task.type}`}>{task.type}</span></td>
                          <td><span className={`pill ${task.status}`}>{task.status}</span></td>
                          <td className="metadata mono">{task.source ?? 'direct'}</td>
                          <td className="metadata">{formatDate(task.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Sessions</h2>
                  <p className="section-copy">Conversation continuity grouped by agent and channel.</p>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Agent</th>
                      <th>Channel</th>
                      <th>Messages</th>
                      <th>Last Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.sessions.length === 0 ? (
                      <tr>
                        <td className="empty" colSpan={4}>No sessions yet.</td>
                      </tr>
                    ) : null}
                    {snapshot.sessions.map((session) => (
                      <tr key={session.id}>
                        <td>
                          <div>{session.agentName}</div>
                          <div className="metadata mono">{session.id}</div>
                        </td>
                        <td>
                          <div>{session.channel}</div>
                          <div className="metadata mono">{session.channelKey}</div>
                        </td>
                        <td>{session.messageCount}</td>
                        <td className="metadata">{formatDate(session.lastActive)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="stack">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Triggers</h2>
                  <p className="section-copy">Keep proactivity visible, but lightweight.</p>
                </div>
              </div>

              <form action={createTriggerAction} className="form-grid">
                <div className="field">
                  <label htmlFor="trigger-agent">Agent</label>
                  <select defaultValue={snapshot.agents[0]?.id ?? ''} id="trigger-agent" name="agentId" required>
                    {snapshot.agents.length === 0 ? <option value="">Create an agent first</option> : null}
                    {snapshot.agents.map((agent) => (
                      <option key={agent.id} value={agent.id}>{agent.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="trigger-name">Name</label>
                  <input id="trigger-name" name="name" placeholder="Morning check-in" required />
                </div>
                <div className="field">
                  <label htmlFor="trigger-type">Type</label>
                  <select defaultValue="heartbeat" id="trigger-type" name="type">
                    <option value="heartbeat">heartbeat</option>
                    <option value="cron">cron</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="trigger-schedule">Schedule</label>
                  <input id="trigger-schedule" name="schedule" placeholder="15 or 0 9 * * *" required />
                </div>
                <div className="actions">
                  <button className="button" disabled={snapshot.agents.length === 0} type="submit">Create Trigger</button>
                </div>
              </form>

              <div className="card-list" style={{ marginTop: '1rem' }}>
                {snapshot.triggers.length === 0 ? <p className="empty">No triggers configured.</p> : null}
                {snapshot.triggers.map((trigger) => {
                  const agent = snapshot.agents.find((entry) => entry.id === trigger.agentId);
                  return (
                    <article className="card" key={trigger.id}>
                      <div className="card-header">
                        <div>
                          <h3>{trigger.name}</h3>
                          <div className="pills">
                            <span className={`pill ${trigger.type}`}>{trigger.type}</span>
                            <span className={`pill ${trigger.enabled ? 'enabled' : 'disabled'}`}>
                              {trigger.enabled ? 'enabled' : 'disabled'}
                            </span>
                          </div>
                        </div>
                        <div className="actions">
                          <form action={toggleTriggerAction}>
                            <input name="triggerId" type="hidden" value={trigger.id} />
                            <button className="ghost-button" type="submit">
                              {trigger.enabled ? 'Disable' : 'Enable'}
                            </button>
                          </form>
                          <form action={deleteTriggerAction}>
                            <input name="triggerId" type="hidden" value={trigger.id} />
                            <button className="danger-button" type="submit">Delete</button>
                          </form>
                        </div>
                      </div>
                      <p className="metadata">{agent ? `Agent: ${agent.name}` : trigger.agentId}</p>
                      <p className="metadata mono">
                        {trigger.type === 'heartbeat'
                          ? `interval=${trigger.config.interval ?? 'n/a'} minutes`
                          : `cron=${trigger.config.cronExpression ?? 'n/a'}`}
                      </p>
                      <p className="metadata">Next: {formatDate(trigger.nextTrigger)} | Last: {formatDate(trigger.lastTriggered)}</p>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>Workspace</h2>
                  <p className="section-copy">Edit operator documents from the same origin as the runtime shell.</p>
                </div>
              </div>
              <div className="workspace-layout">
                <div className="file-list">
                  {snapshot.workspaceFiles.map((file) => {
                    const active = file.name === snapshot.selectedWorkspaceFile?.name;
                    return (
                      <a
                        className={`file-link${active ? ' active' : ''}`}
                        href={`/?workspace=${encodeURIComponent(file.name)}`}
                        key={file.name}
                      >
                        <div>{file.name}</div>
                        <div className="metadata">{file.size} bytes</div>
                      </a>
                    );
                  })}
                </div>
                <div>
                  <form action={saveWorkspaceAction} className="field">
                    <input name="workspace" type="hidden" value={snapshot.selectedWorkspaceFile?.name ?? ''} />
                    <div className="field">
                      <label htmlFor="workspace-file">File name</label>
                      <input
                        defaultValue={snapshot.selectedWorkspaceFile?.name ?? 'OPERATIONS.md'}
                        id="workspace-file"
                        name="fileName"
                        required
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="workspace-content">Content</label>
                      <textarea
                        defaultValue={snapshot.selectedWorkspaceFile?.content ?? '# Operations\n\n'}
                        id="workspace-content"
                        name="content"
                      />
                    </div>
                    <div className="actions">
                      <button className="button" type="submit">Save Workspace File</button>
                    </div>
                  </form>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
