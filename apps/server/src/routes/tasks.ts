// Task routes (docs/done-checks/12-tasks.md, 12a). Registered under /api.
// Signed out: 401 on every route (requireUser). Permission and the logic are in
// tasks/tasks.ts, through the one permission path.
import type { FastifyInstance } from 'fastify';
import { spacePeopleQuery, tickTaskBody, type MyTaskList, type SpacePeopleList, type TickTaskReply } from '@stillwater/shared';
import { requireUser } from '../auth/guard.js';
import { parse, uuidParam } from '../http.js';
import { myOpenTasks, spacePeople, tickTask } from '../tasks/tasks.js';

type TaskParams = { Params: { id: string; taskId: string } };
type KeyParams = { Params: { key: string } };

export async function taskRoutes(app: FastifyInstance) {
  const db = app.db;

  app.get('/me/tasks', async (req): Promise<MyTaskList> => ({ tasks: await myOpenTasks(db, requireUser(req)) }));

  app.patch<TaskParams>('/pages/:id/tasks/:taskId', async (req): Promise<TickTaskReply> => {
    const user = requireUser(req);
    const id = uuidParam(req.params.id, 'Page not found');
    const { checked } = parse(tickTaskBody, req.body);
    // A task id not on the page (malformed ones never are) is 404, after the page's own 404/403.
    return tickTask(db, user, id, req.params.taskId, checked);
  });

  app.get<KeyParams>('/spaces/:key/people', async (req): Promise<SpacePeopleList> => {
    const user = requireUser(req);
    const { q } = parse(spacePeopleQuery, req.query);
    return { people: await spacePeople(db, user, req.params.key, q || undefined) };
  });
}
