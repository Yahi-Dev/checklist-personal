import { Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { Subject } from '../../domain/schedule/subject';
import type { SubjectNote, SubjectNoteKind } from '../../domain/schedule/subject-note';

import { Badge } from '../../shared/ui/feedback';
import { Button } from '../../shared/ui/button';
import { cn } from '../../shared/lib/cn';
import { SUBJECT_NOTE_KIND_LABEL, SUBJECT_NOTE_KINDS } from '../../domain/schedule/subject-note';
import { Textarea } from '../../shared/ui/form-controls';
import { useScheduleActions } from './use-schedule-actions';
import { useSubjectNotes } from '../../shared/hooks/use-live-query';

/**
 * Lo que el profesor dijo y no es una tarea.
 *
 * El tipo se elige ANTES de escribir, con un toque, y no en un desplegable escondido al
 * final: es la unica forma de que se marque de verdad cuando estas copiando algo a toda
 * prisa en mitad de la clase. Un campo que hay que ir a buscar se queda siempre en su
 * valor por defecto.
 */

const KIND_TONE: Readonly<Record<SubjectNoteKind, string>> = {
  exam: 'border-danger/40 bg-danger/10 text-danger',
  assignment: 'border-warning/40 bg-warning/10 text-warning',
  notice:
    'border-brand-500/40 bg-brand-100/50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300',
  note: 'border-line bg-sunken text-ink-soft',
};

export interface SubjectNotesSectionProps {
  readonly subject: Subject;
}

export const SubjectNotesSection = ({ subject }: SubjectNotesSectionProps) => {
  const notes = useSubjectNotes(subject.id);
  const actions = useScheduleActions();

  const [isWriting, setIsWriting] = useState(false);
  const [kind, setKind] = useState<SubjectNoteKind>('note');
  const [body, setBody] = useState('');

  const save = async () => {
    if (body.trim().length === 0) return;

    const created = await actions.createNote({ subjectId: subject.id, body, kind });
    if (created === null) return;

    setBody('');
    setKind('note');
    setIsWriting(false);
  };

  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Notas</h3>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Añadir nota"
          onClick={() => {
            setIsWriting((previous) => !previous);
          }}
        >
          <Plus className={cn('size-4 transition-transform', isWriting && 'rotate-45')} />
        </Button>
      </header>

      {isWriting && (
        <div className="space-y-2 rounded-card border border-line bg-sunken p-3">
          <div className="flex flex-wrap gap-1.5">
            {SUBJECT_NOTE_KINDS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={kind === option}
                onClick={() => {
                  setKind(option);
                }}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none',
                  kind === option ? KIND_TONE[option] : 'border-line text-ink-muted hover:bg-hover',
                )}
              >
                {SUBJECT_NOTE_KIND_LABEL[option]}
              </button>
            ))}
          </div>

          <Textarea
            value={body}
            rows={3}
            placeholder="El parcial cubre hasta el capitulo 4"
            aria-label="Texto de la nota"
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsWriting(false);
                setBody('');
              }}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={body.trim().length === 0}
              onClick={() => void save()}
            >
              Guardar
            </Button>
          </div>
        </div>
      )}

      {notes === undefined ? null : notes.length === 0 ? (
        !isWriting && (
          <p className="px-1 py-2 text-xs text-ink-muted">
            Nada apuntado todavia. Aqui van los avisos del profesor y lo que entra en el examen.
          </p>
        )
      ) : (
        <ul className="space-y-1.5">
          {notes.map((note) => (
            <NoteRow key={note.id} note={note} />
          ))}
        </ul>
      )}
    </section>
  );
};

const NoteRow = ({ note }: { note: SubjectNote }) => {
  const actions = useScheduleActions();

  return (
    <li
      className={cn(
        'group flex items-start gap-2 rounded-card border border-line/70 bg-panel p-3',
        note.isPinned && 'border-brand-500/50',
      )}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <Badge size="sm" variant="outline" className={cn('border', KIND_TONE[note.kind])}>
          {SUBJECT_NOTE_KIND_LABEL[note.kind]}
        </Badge>
        {/* `whitespace-pre-line`: los saltos de linea se conservan a proposito, porque una
            nota pegada del grupo suele ser una lista y aplastarla la vuelve ilegible. */}
        <p className="text-sm whitespace-pre-line text-ink">{note.body}</p>
      </div>

      <div className="flex shrink-0 flex-col gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={note.isPinned ? 'Quitar de arriba' : 'Fijar arriba'}
          onClick={() => void actions.toggleNotePinned(note.id)}
        >
          {note.isPinned ? (
            <PinOff className="size-3.5" />
          ) : (
            <Pin className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Borrar nota"
          onClick={() => void actions.deleteNote(note.id)}
        >
          <Trash2 className="size-3.5 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100" />
        </Button>
      </div>
    </li>
  );
};
