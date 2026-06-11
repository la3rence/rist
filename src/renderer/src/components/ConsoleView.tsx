import { FormEvent, ReactElement, useEffect, useRef } from 'react';
import { TerminalSquare, Trash2 } from 'lucide-react';
import type { ConnectionSummary } from '../../../shared/types';
import { formatConsoleValue } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { ConsoleEntry } from '../types';

export function ConsoleView(props: {
  command: string;
  connection: ConnectionSummary | null;
  history: ConsoleEntry[];
  onCommandChange(command: string): void;
  onDeleteEntry(id: string): void;
  onRunCommand(event: FormEvent<HTMLFormElement>): void;
}): ReactElement {
  const { t } = useI18n();
  const commandInput = useRef<HTMLInputElement>(null);
  const historyPane = useRef<HTMLDivElement>(null);
  const lastEntry = props.history[props.history.length - 1];

  useEffect(() => {
    const pane = historyPane.current;
    if (!pane) return;
    requestAnimationFrame(() => {
      pane.scrollTop = pane.scrollHeight;
    });
  }, [props.history.length, lastEntry?.result, lastEntry?.error, props.connection?.id]);

  return (
    <>
      <header className="toolbar console-toolbar">
        <div>
          <TerminalSquare size={16} />
          <span>{props.connection ? props.connection.name : t('console')}</span>
        </div>
      </header>
      <section className="terminal-pane">
        <div className="terminal-history" ref={historyPane}>
          {props.history.length === 0 ? (
            <div className="empty-state">
              <TerminalSquare size={28} />
              <p>{props.connection ? t('consoleReady') : t('noConnection')}</p>
            </div>
          ) : (
            props.history.map((entry) => (
              <article className="console-entry" key={entry.id}>
                <div className="console-entry-head">
                  <div className="console-input">
                    <span>&gt;</span>
                    <code>{entry.command}</code>
                  </div>
                  <button className="console-delete" onClick={() => props.onDeleteEntry(entry.id)} title={t('deleteHistoryEntry')}>
                    <Trash2 size={13} />
                  </button>
                </div>
                <pre className={entry.error ? 'console-output error' : 'console-output'}>{entry.error ?? formatConsoleValue(entry.result)}</pre>
              </article>
            ))
          )}
        </div>
        <form
          className={props.connection ? 'terminal-command' : 'terminal-command disconnected'}
          onClick={() => commandInput.current?.focus()}
          onSubmit={props.onRunCommand}
          title={props.connection ? undefined : t('noActiveConnection')}
        >
          <span className="terminal-prompt">redis&gt;</span>
          <input ref={commandInput} value={props.command} disabled={!props.connection} onChange={(event) => props.onCommandChange(event.target.value)} spellCheck={false} />
        </form>
      </section>
    </>
  );
}
