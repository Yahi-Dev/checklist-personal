import { GraduationCap, MoreHorizontal, Plus, RefreshCw } from 'lucide-react';
import { useState } from 'react';

import type { Subject } from '../domain/schedule/subject';
import type { Task } from '../domain/task/task';

import {
  activeTermCode,
  buildWeeklySchedule,
  termCodesOf,
} from '../domain/schedule/weekly-schedule';
import { AddClassDialog } from '../features/schedule/add-class-dialog';
import { Badge } from '../shared/ui/feedback';
import { Button } from '../shared/ui/button';
import { SubjectSheet } from '../features/schedule/subject-sheet';
import { TaskDetailSheet } from '../features/task-detail/task-detail-sheet';
import { countClasses, formatClassCount, minutesOfDay } from '../features/schedule/schedule-format';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../shared/ui/overlays';
import { EmptyState, TaskListSkeleton } from '../shared/ui/feedback';
import { ImportScheduleDialog } from '../features/schedule/import-schedule-dialog';
import { isTermActive } from '../domain/schedule/subject';
import { PageContent, PageHeader } from '../shared/ui/layout';
import { ScheduleDayCard } from '../features/schedule/schedule-day-card';
import { toDateKey } from '../shared/lib/date-format';
import { useNow } from '../shared/hooks/use-now';
import { useScheduleActions } from '../features/schedule/use-schedule-actions';
import { useScheduleBlocks, useSubjects } from '../shared/hooks/use-live-query';

/**
 * El horario de la universidad, cuatrimestre a cuatrimestre.
 *
 * Se enseña SIEMPRE el cuatrimestre que contiene el dia de hoy y, si no hay ninguno
 * vigente, el mas reciente con un aviso de que ya termino. La alternativa -no enseñar
 * nada fuera de fechas- dejaba la pantalla vacia justo en la semana entre cuatrimestres,
 * que es exactamente cuando el usuario entra aqui a importar el siguiente.
 */
export const SchedulePage = () => {
  const subjects = useSubjects();
  const blocks = useScheduleBlocks();
  const actions = useScheduleActions();
  const now = new Date(useNow());

  const [termCode, setTermCode] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const today = toDateKey(now);

  /* Sin `useMemo`: el compilador de React memoiza esto solo, y hacerlo a mano con
     `activeTerm` en las dependencias le impide optimizar el componente entero. */
  const terms = termCodesOf(subjects ?? []);

  /* El cuatrimestre elegido a mano manda; si no hay eleccion, decide la fecha. Se
     guarda como `null` y no con el valor por defecto para que al importar uno nuevo la
     pantalla salte sola al que toca en vez de quedarse en el viejo. */
  const activeTerm = termCode ?? activeTermCode(subjects ?? [], today);

  const days =
    activeTerm === null
      ? []
      : buildWeeklySchedule(subjects ?? [], blocks ?? [], { termCode: activeTerm });

  const isLoading = subjects === undefined || blocks === undefined;
  const total = countClasses(days);
  const nowMinutes = minutesOfDay(now);
  const todayWeekday = now.getDay();

  const termEnded =
    activeTerm !== null &&
    (subjects ?? []).some(
      (subject) => subject.termCode === activeTerm && !isTermActive(subject, today),
    );

  return (
    <>
      <PageHeader
        title="Horario"
        subtitle={
          isLoading
            ? undefined
            : total === 0
              ? 'Importa el PDF de la universidad'
              : `${formatClassCount(total)} · toca una para editarla`
        }
        actions={
          <>
            <Button
              variant={total === 0 ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => {
                setIsImporting(true);
              }}
              trailingIcon={<RefreshCw className="size-3.5" />}
            >
              {total === 0 ? 'Importar' : 'Actualizar'}
            </Button>

            {total > 0 && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Añadir clase"
                onClick={() => {
                  setIsAdding(true);
                }}
              >
                <Plus className="size-4" />
              </Button>
            )}

            {terms.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Mas opciones">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Cuatrimestre</DropdownMenuLabel>
                  {terms.map((code) => (
                    <DropdownMenuItem
                      key={code}
                      onSelect={() => {
                        setTermCode(code);
                      }}
                    >
                      <span className="font-mono">{code}</span>
                      {code === activeTerm && (
                        <Badge variant="brand" size="sm" className="ml-auto">
                          Viendo
                        </Badge>
                      )}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    destructive
                    onSelect={() => {
                      if (activeTerm !== null) void actions.deleteTerm(activeTerm);
                      setTermCode(null);
                    }}
                  >
                    Borrar este cuatrimestre
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      >
        {activeTerm !== null && total > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-ink-muted">{activeTerm}</span>
            {termEnded && (
              <Badge variant="warning" size="sm">
                Cuatrimestre terminado
              </Badge>
            )}
          </div>
        )}
      </PageHeader>

      <PageContent>
        {isLoading ? (
          <TaskListSkeleton count={3} />
        ) : total === 0 ? (
          <EmptyState
            icon={<GraduationCap />}
            title="Todavia no hay horario"
            description="Suelta aqui el PDF que descargas del portal de la universidad y se crea solo, con todas tus asignaturas y sus aulas."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setIsImporting(true);
                }}
              >
                Importar el PDF
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {days.map((day, index) => (
              <ScheduleDayCard
                key={day.weekday}
                day={day}
                isToday={day.weekday === todayWeekday}
                nowMinutes={nowMinutes}
                entranceDelayMs={Math.min(index * 45, 270)}
                onSelect={(item) => {
                  setSelectedSubject(item.subject);
                }}
              />
            ))}
          </div>
        )}
      </PageContent>

      <ImportScheduleDialog
        open={isImporting}
        onOpenChange={setIsImporting}
        onImported={(summary) => {
          // Se salta al cuatrimestre recien importado: quedarse en el anterior daria la
          // sensacion de que la importacion no ha hecho nada.
          setTermCode(summary.termCode);
        }}
      />

      {activeTerm !== null && (
        <AddClassDialog
          open={isAdding}
          onOpenChange={setIsAdding}
          termCode={activeTerm}
          subjects={(subjects ?? []).filter((subject) => subject.termCode === activeTerm)}
        />
      )}

      <SubjectSheet
        subject={selectedSubject}
        blocks={blocks ?? []}
        onClose={() => {
          setSelectedSubject(null);
        }}
        onOpenTask={(task) => {
          /* Se CIERRA la hoja de la materia antes de abrir la tarea en vez de apilar un
             dialogo sobre otro: dos hojas superpuestas en un movil dejan al usuario sin
             saber cual cierra el gesto de arrastrar hacia abajo. */
          setSelectedSubject(null);
          setSelectedTask(task);
        }}
      />

      <TaskDetailSheet
        task={selectedTask}
        open={selectedTask !== null}
        onOpenChange={(next) => {
          if (!next) setSelectedTask(null);
        }}
      />
    </>
  );
};
