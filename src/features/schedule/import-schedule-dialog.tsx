import { AlertTriangle, FileUp, Loader2 } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';

import type { DragEvent } from 'react';
import type { ImportScheduleSummary } from '../../application/use-cases/schedule/import-schedule-pdf';

import { Button } from '../../shared/ui/button';
import { cn } from '../../shared/lib/cn';
import { Dialog, DialogContent } from '../../shared/ui/overlays';
import { useScheduleActions } from './use-schedule-actions';

/**
 * Soltar el PDF del horario y ver que va a pasar antes de que pase.
 *
 * La importacion no es solo "añadir": tambien da de baja lo que ya no viene en el
 * documento. Escribir eso sin avisar seria una sorpresa desagradable el dia que alguien
 * suelte por error el horario del cuatrimestre pasado, asi que hay dos tiempos: primero
 * se analiza el documento SIN escribir nada y se enseña el recuento, y solo despues, con
 * el boton, se guarda.
 *
 * No se pasa por `platform.pickFile`: ese puerto lee texto y un PDF leido como texto se
 * corrompe sin remedio. Aqui se usa el selector del navegador, que en Electron es el
 * mismo dialogo nativo del sistema, y se leen los BYTES.
 */

export interface ImportScheduleDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onImported: (summary: ImportScheduleSummary) => void;
}

type Stage =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading' }
  | {
      readonly kind: 'preview';
      readonly summary: ImportScheduleSummary;
      readonly bytes: Uint8Array;
    }
  | { readonly kind: 'saving' };

export const ImportScheduleDialog = ({
  open,
  onOpenChange,
  onImported,
}: ImportScheduleDialogProps) => {
  const actions = useScheduleActions();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [isDragging, setIsDragging] = useState(false);

  const reset = useCallback(() => {
    setStage({ kind: 'idle' });
    setIsDragging(false);
  }, []);

  const analyze = useCallback(
    async (file: File) => {
      setStage({ kind: 'reading' });

      const bytes = new Uint8Array(await file.arrayBuffer());
      const summary = await actions.previewImport(bytes);

      if (summary === null) {
        setStage({ kind: 'idle' });
        return;
      }

      setStage({ kind: 'preview', summary, bytes });
    },
    [actions],
  );

  const confirm = useCallback(async () => {
    if (stage.kind !== 'preview') return;

    setStage({ kind: 'saving' });
    const summary = await actions.importPdf(stage.bytes);

    if (summary === null) {
      setStage({ kind: 'idle' });
      return;
    }

    onImported(summary);
    reset();
    onOpenChange(false);
  }, [actions, onImported, onOpenChange, reset, stage]);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files.item(0);
    if (file !== null) void analyze(file);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent
        title="Importar horario"
        description="El PDF que descargas del portal de la universidad, tal cual."
        size="md"
        footer={
          stage.kind === 'preview' ? (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={reset}>
                Elegir otro
              </Button>
              <Button variant="primary" onClick={() => void confirm()}>
                Guardar horario
              </Button>
            </div>
          ) : undefined
        }
      >
        <div className="space-y-4 px-5 py-4">
          {stage.kind === 'preview' ? (
            <SummaryView summary={stage.summary} />
          ) : (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => {
                setIsDragging(false);
              }}
              onDrop={onDrop}
              className={cn(
                'flex flex-col items-center gap-3 rounded-card border-2 border-dashed px-6 py-10 text-center',
                'transition-colors duration-200',
                isDragging
                  ? 'border-brand-500 bg-brand-100/40 dark:bg-brand-900/20'
                  : 'border-line',
              )}
            >
              {stage.kind === 'reading' || stage.kind === 'saving' ? (
                <>
                  <Loader2 className="size-7 animate-spin text-brand-500" aria-hidden="true" />
                  <p className="text-sm text-ink-soft">
                    {stage.kind === 'reading' ? 'Leyendo el documento…' : 'Guardando…'}
                  </p>
                </>
              ) : (
                <>
                  <FileUp className="size-7 text-ink-muted" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-ink">Arrastra aqui el PDF</p>
                    <p className="text-xs text-ink-muted">
                      Horario de estudiantes · UNIBE. Se detecta solo el cuatrimestre.
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      inputRef.current?.click();
                    }}
                  >
                    Buscar el archivo
                  </Button>
                </>
              )}

              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                aria-label="Archivo PDF del horario"
                onChange={(event) => {
                  const file = event.target.files?.item(0);
                  // Se limpia el valor para que elegir DOS VECES el mismo archivo vuelva
                  // a disparar el evento; si no, el segundo intento no hace nada.
                  event.target.value = '';
                  if (file !== null && file !== undefined) void analyze(file);
                }}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

const SummaryView = ({ summary }: { summary: ImportScheduleSummary }) => (
  <div className="space-y-4">
    <div className="rounded-card border border-line bg-sunken px-4 py-3">
      <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Cuatrimestre</p>
      <p className="mt-0.5 font-mono text-lg font-semibold text-ink">{summary.termCode}</p>
      {summary.studentName !== null && (
        <p className="mt-1 truncate text-xs text-ink-muted">{summary.studentName}</p>
      )}
    </div>

    <dl className="grid grid-cols-3 gap-2">
      <Tally label="Nuevas" value={summary.createdSubjects} tone="brand" />
      <Tally label="Actualizadas" value={summary.updatedSubjects} tone="neutral" />
      <Tally label="De baja" value={summary.removedSubjects} tone="danger" />
    </dl>

    <p className="text-xs text-ink-muted">
      {summary.createdBlocks + summary.updatedBlocks} clases en la semana
      {summary.removedBlocks > 0 && ` · ${String(summary.removedBlocks)} se quitan`}
    </p>

    {summary.warnings.length > 0 && (
      <ul className="space-y-1.5 rounded-card border border-warning/40 bg-warning/10 px-3 py-2.5">
        {summary.warnings.map((warning) => (
          <li key={warning} className="flex gap-2 text-xs text-ink-soft">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
            {warning}
          </li>
        ))}
      </ul>
    )}
  </div>
);

const TONE = {
  brand: 'text-brand-600 dark:text-brand-400',
  neutral: 'text-ink',
  danger: 'text-danger',
} as const;

const Tally = ({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: keyof typeof TONE;
}) => (
  <div className="rounded-xl border border-line px-3 py-2">
    <dd
      className={cn(
        'text-xl font-semibold tabular-nums',
        value === 0 ? 'text-ink-muted' : TONE[tone],
      )}
    >
      {value}
    </dd>
    <dt className="text-[11px] text-ink-muted">{label}</dt>
  </div>
);
