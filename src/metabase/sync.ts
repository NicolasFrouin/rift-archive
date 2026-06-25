import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type MetabaseDashboardSummary = {
  id: number;
  name: string;
  description?: string | null;
};

type MetabaseCardSummary = {
  id: number;
  name: string;
  description?: string | null;
};

type MetabaseDashboardDetails = {
  id: number;
  dashcards: Array<{ id: number }>;
};

type CardDefinition = {
  id: string;
  name: string;
  description?: string;
  display?: string;
  queryFile: string;
};

type DashboardCardDefinition = {
  cardId: string;
  row: number;
  col: number;
  sizeX: number;
  sizeY: number;
};

type DashboardDefinition = {
  id: string;
  name: string;
  description?: string;
  cards: DashboardCardDefinition[];
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const metabaseDir = join(root, 'metabase');

function idMarker(id: string): string {
  return `[rift-archive-id:${id}]`;
}

function withMarker(id: string, description?: string): string {
  const marker = idMarker(id);
  if (!description) return marker;
  return `${description}\n\n${marker}`;
}

function hasMarker(description: string | null | undefined, id: string): boolean {
  if (!description) return false;
  return description.includes(idMarker(id));
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw) as T;
}

async function loadCards(): Promise<CardDefinition[]> {
  const cardsDir = join(metabaseDir, 'cards');
  const files = (await readdir(cardsDir)).filter((file) => file.endsWith('.json')).sort();

  const cards = await Promise.all(
    files.map(async (file): Promise<CardDefinition> => {
      const fullPath = join(cardsDir, file);
      const card = await readJsonFile<CardDefinition>(fullPath);
      if (!card.id || !card.name || !card.queryFile) {
        throw new Error(`Invalid card definition in ${file}`);
      }
      return card;
    }),
  );

  return cards;
}

async function loadDashboards(): Promise<DashboardDefinition[]> {
  const dashboardsDir = join(metabaseDir, 'dashboards');
  const files = (await readdir(dashboardsDir)).filter((file) => file.endsWith('.json')).sort();

  const dashboards = await Promise.all(
    files.map(async (file): Promise<DashboardDefinition> => {
      const fullPath = join(dashboardsDir, file);
      const dashboard = await readJsonFile<DashboardDefinition>(fullPath);
      if (!dashboard.id || !dashboard.name || !Array.isArray(dashboard.cards)) {
        throw new Error(`Invalid dashboard definition in ${file}`);
      }
      return dashboard;
    }),
  );

  return dashboards;
}

class MetabaseClient {
  private readonly baseUrl: string;

  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers ?? {});
    headers.set('Content-Type', 'application/json');
    if (this.token) {
      headers.set('X-Metabase-Session', this.token);
    }

    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Metabase request failed (${res.status}) ${path}: ${text}`);
    }

    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  async login(username: string, password: string): Promise<void> {
    const out = await this.request<{ id: string }>('/api/session', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.token = out.id;
  }

  async listDatabases(): Promise<Array<{ id: number; name: string }>> {
    const out = await this.request<{ data: Array<{ id: number; name: string }> }>('/api/database');
    return out.data;
  }

  async listCards(): Promise<MetabaseCardSummary[]> {
    const out = await this.request<MetabaseCardSummary[] | { data: MetabaseCardSummary[] }>('/api/card?f=all');
    return Array.isArray(out) ? out : out.data;
  }

  async listDashboards(): Promise<MetabaseDashboardSummary[]> {
    const out = await this.request<
      MetabaseDashboardSummary[] | { data: MetabaseDashboardSummary[] }
    >('/api/dashboard?f=all');
    return Array.isArray(out) ? out : out.data;
  }

  async createCard(payload: Record<string, unknown>): Promise<{ id: number }> {
    return this.request<{ id: number }>('/api/card', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateCard(id: number, payload: Record<string, unknown>): Promise<{ id: number }> {
    return this.request<{ id: number }>(`/api/card/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async createDashboard(payload: Record<string, unknown>): Promise<{ id: number }> {
    return this.request<{ id: number }>('/api/dashboard', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateDashboard(id: number, payload: Record<string, unknown>): Promise<{ id: number }> {
    return this.request<{ id: number }>(`/api/dashboard/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async getDashboard(id: number): Promise<MetabaseDashboardDetails> {
    return this.request<MetabaseDashboardDetails>(`/api/dashboard/${id}`);
  }

  async deleteDashboardCard(dashboardId: number, dashcardId: number): Promise<void> {
    await this.request<void>(`/api/dashboard/${dashboardId}/cards/${dashcardId}`, {
      method: 'DELETE',
    });
  }

  async addDashboardCard(dashboardId: number, payload: Record<string, unknown>): Promise<void> {
    await this.request(`/api/dashboard/${dashboardId}/cards`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

async function syncCards(
  client: MetabaseClient,
  databaseId: number,
  cards: CardDefinition[],
): Promise<Map<string, number>> {
  const existing = await client.listCards();
  const cardIds = new Map<string, number>();

  for (const card of cards) {
    const query = await readFile(join(metabaseDir, 'cards', card.queryFile), 'utf8');
    const payload: Record<string, unknown> = {
      name: card.name,
      description: withMarker(card.id, card.description),
      display: card.display ?? 'table',
      dataset_query: {
        type: 'native',
        database: databaseId,
        native: {
          query,
          'template-tags': {},
        },
      },
    };

    const match = existing.find((entry) => hasMarker(entry.description, card.id));

    if (match) {
      await client.updateCard(match.id, payload);
      cardIds.set(card.id, match.id);
    } else {
      const created = await client.createCard(payload);
      cardIds.set(card.id, created.id);
    }
  }

  return cardIds;
}

async function syncDashboards(
  client: MetabaseClient,
  dashboards: DashboardDefinition[],
  cardIds: Map<string, number>,
): Promise<void> {
  const existing = await client.listDashboards();

  for (const dashboard of dashboards) {
    const payload = {
      name: dashboard.name,
      description: withMarker(dashboard.id, dashboard.description),
      parameters: [],
    };

    const match = existing.find((entry) => hasMarker(entry.description, dashboard.id));

    const dashboardId = match
      ? (await client.updateDashboard(match.id, payload)).id
      : (await client.createDashboard(payload)).id;

    const details = await client.getDashboard(dashboardId);
    for (const dashcard of details.dashcards) {
      await client.deleteDashboardCard(dashboardId, dashcard.id);
    }

    for (const card of dashboard.cards) {
      const cardId = cardIds.get(card.cardId);
      if (!cardId) {
        throw new Error(
          `Dashboard ${dashboard.id} references unknown card id ${card.cardId}. Check metabase/cards/*.json.`,
        );
      }
      await client.addDashboardCard(dashboardId, {
        cardId,
        row: card.row,
        col: card.col,
        sizeX: card.sizeX,
        sizeY: card.sizeY,
        parameter_mappings: [],
      });
    }
  }
}

export type SyncMetabaseOptions = {
  url?: string;
  username?: string;
  password?: string;
  databaseName?: string;
};

export async function syncMetabaseDashboards(options: SyncMetabaseOptions = {}): Promise<void> {
  const url =
    options.url ??
    process.env.WORKER_MB_URL ??
    process.env.MB_SITE_URL ??
    process.env.MB_URL ??
    process.env.METABASE_URL ??
    'http://metabase:3000';
  const username =
    options.username ??
    process.env.WORKER_MB_USERNAME ??
    process.env.MB_USERNAME ??
    process.env.MB_ADMIN_EMAIL ??
    process.env.METABASE_USERNAME;
  const password =
    options.password ??
    process.env.WORKER_MB_PASSWORD ??
    process.env.MB_PASSWORD ??
    process.env.MB_ADMIN_PASSWORD ??
    process.env.METABASE_PASSWORD;
  const databaseName =
    options.databaseName ??
    process.env.WORKER_MB_DATABASE_NAME ??
    process.env.MB_DATABASE_NAME ??
    process.env.METABASE_DATABASE_NAME ??
    process.env.POSTGRES_DB ??
    'lol';

  if (!username || !password) {
    throw new Error(
      'Metabase credentials are required. Set WORKER_MB_USERNAME/WORKER_MB_PASSWORD, MB_USERNAME/MB_PASSWORD (or MB_ADMIN_EMAIL/MB_ADMIN_PASSWORD), METABASE_USERNAME/METABASE_PASSWORD, or pass --username/--password.',
    );
  }

  const cards = await loadCards();
  const dashboards = await loadDashboards();

  const client = new MetabaseClient(url);
  await client.login(username, password);

  const database = (await client.listDatabases()).find((db) => db.name === databaseName);
  if (!database) {
    throw new Error(
      `Metabase database "${databaseName}" not found. Ensure Metabase has a Postgres connection to your app DB.`,
    );
  }

  const cardIds = await syncCards(client, database.id, cards);
  await syncDashboards(client, dashboards, cardIds);
}
