// Label routes (docs/done-checks/13-labels.md, 13a). Registered under /api.
// Signed out: 401 on every route (requireUser). Permission and the logic are
// in labels/labels.ts, through the one permission path.
import type { FastifyInstance } from 'fastify';
import {
  addLabelBody,
  labelSuggestionsQuery,
  type LabelSuggestionList,
  type LabelView,
  type PageLabelsReply,
} from '@stillwater/shared';
import { requireUser } from '../auth/guard.js';
import { parse, uuidParam } from '../http.js';
import { addLabel, removeLabel, spaceLabelView, suggestLabels, wikiLabelView } from '../labels/labels.js';

type PageParams = { Params: { id: string } };
type RemoveParams = { Params: { id: string; labelId: string } };
type NameParams = { Params: { name: string } };
type SpaceNameParams = { Params: { key: string; name: string } };

export async function labelRoutes(app: FastifyInstance) {
  const db = app.db;
  const pageId = (raw: string) => uuidParam(raw, 'Page not found');

  app.post<PageParams>('/pages/:id/labels', async (req): Promise<PageLabelsReply> => {
    const user = requireUser(req);
    const id = pageId(req.params.id);
    const { name } = parse(addLabelBody, req.body);
    return { labels: await addLabel(db, user, id, name) };
  });

  app.delete<RemoveParams>('/pages/:id/labels/:labelId', async (req): Promise<PageLabelsReply> => {
    const user = requireUser(req);
    return { labels: await removeLabel(db, user, pageId(req.params.id), req.params.labelId) };
  });

  app.get('/labels', async (req): Promise<LabelSuggestionList> => {
    const user = requireUser(req);
    const { q } = parse(labelSuggestionsQuery, req.query);
    return { labels: await suggestLabels(db, user, q) };
  });

  app.get<NameParams>('/labels/:name/pages', async (req): Promise<LabelView> =>
    wikiLabelView(db, requireUser(req), req.params.name),
  );

  app.get<SpaceNameParams>('/spaces/:key/labels/:name/pages', async (req): Promise<LabelView> =>
    spaceLabelView(db, requireUser(req), req.params.key, req.params.name),
  );
}
