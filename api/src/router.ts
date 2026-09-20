import { Env } from './types';
import { json, error, corsHeaders } from './utils';
import { handleSocietes } from './routes/societes';
import { handlePlansComptes } from './routes/plans_comptes';
import { handleJournaux } from './routes/journaux';
import { handleDossiers } from './routes/dossiers';
import { handlePieces } from './routes/pieces';
import { handleEcritures } from './routes/ecritures';
import { handleAnomalies } from './routes/anomalies';
import { handleExport } from './routes/export';
import { handleDashboard } from './routes/dashboard';
import { handleOrgLogin, handleOrgMe, handleOrgChangePassword } from './routes/orgAuth';
import {
  handleOrgClients, handleOrgCreateClient, handleOrgReassignClient,
  handleOrgClientDossiers, handleOrgGetDossier, handleOrgCreateDossier,
  handleOrgUpdateTask, handleOrgUpdateDocument, handleOrgCloseDossier,
  handleOrgAddNote, handleOrgTimeline,
  handleOrgComptables, handleOrgAllDossiers, handleOrgCreateComptable, handleOrgToggleComptable,
  handleOrgTemplates, handleOrgDeleteTemplate, handleOrgAuditLog,
} from './routes/organizations';

export async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders() });
  }

  try {
    // --- ORGANIZATION MODULE ---
    // Auth
    if (path === '/api/org/auth/login' && method === 'POST') return handleOrgLogin(request, env);
    if (path === '/api/org/auth/me' && method === 'GET') return handleOrgMe(request, env);
    if (path === '/api/org/auth/change-password' && method === 'POST') return handleOrgChangePassword(request, env);

    // Clients
    if (path === '/api/org/clients' && method === 'GET') return handleOrgClients(request, env);
    if (path === '/api/org/clients' && method === 'POST') return handleOrgCreateClient(request, env);
    if (path.match(/^\/api\/org\/clients\/[^/]+\/reassign$/) && method === 'PATCH') {
      return handleOrgReassignClient(request, env, path.split('/')[4]);
    }
    if (path.match(/^\/api\/org\/clients\/[^/]+\/dossiers$/) && method === 'GET') {
      return handleOrgClientDossiers(request, env, path.split('/')[4]);
    }
    if (path.match(/^\/api\/org\/clients\/[^/]+\/dossiers$/) && method === 'POST') {
      return handleOrgCreateDossier(request, env, path.split('/')[4]);
    }

    // Dossiers
    if (path.match(/^\/api\/org\/dossiers\/[^/]+$/) && method === 'GET') {
      return handleOrgGetDossier(request, env, path.split('/')[4]);
    }
    if (path.match(/^\/api\/org\/dossiers\/[^/]+\/close$/) && method === 'PATCH') {
      return handleOrgCloseDossier(request, env, path.split('/')[4]);
    }

    // Tasks
    if (path.match(/^\/api\/org\/dossiers\/[^/]+\/tasks\/[^/]+$/) && method === 'PATCH') {
      const parts = path.split('/');
      return handleOrgUpdateTask(request, env, parts[4], parts[6]);
    }

    // Documents
    if (path.match(/^\/api\/org\/dossiers\/[^/]+\/documents\/[^/]+$/) && method === 'PATCH') {
      const parts = path.split('/');
      return handleOrgUpdateDocument(request, env, parts[4], parts[6]);
    }

    // Notes
    if (path.match(/^\/api\/org\/dossiers\/[^/]+\/notes$/) && method === 'POST') {
      return handleOrgAddNote(request, env, path.split('/')[4]);
    }

    // Timeline
    if (path.match(/^\/api\/org\/dossiers\/[^/]+\/timeline$/) && method === 'GET') {
      return handleOrgTimeline(request, env, path.split('/')[4]);
    }

    // Audit
    if (path.match(/^\/api\/org\/dossiers\/[^/]+\/audit$/) && method === 'GET') {
      return handleOrgAuditLog(request, env, path.split('/')[4]);
    }

    // Expert-only
    if (path === '/api/org/comptables' && method === 'GET') return handleOrgComptables(request, env);
    if (path === '/api/org/comptables' && method === 'POST') return handleOrgCreateComptable(request, env);
    if (path.match(/^\/api\/org\/comptables\/[^/]+$/) && method === 'PATCH') {
      return handleOrgToggleComptable(request, env, path.split('/')[4]);
    }
    if (path === '/api/org/dossiers' && method === 'GET') return handleOrgAllDossiers(request, env);

    // Templates
    if (path === '/api/org/templates' && (method === 'GET' || method === 'POST')) return handleOrgTemplates(request, env);
    if (path.match(/^\/api\/org\/templates\/[^/]+$/) && method === 'DELETE') {
      return handleOrgDeleteTemplate(request, env, path.split('/')[4]);
    }

    // --- EXISTING ROUTES ---
    if (path === '/api/societes') return handleSocietes(method, request, env);
    if (path.match(/^\/api\/societes\/[^/]+$/)) return handleSocietes(method, request, env, path);
    if (path.match(/^\/api\/societes\/[^/]+\/plans-comptes$/)) return handlePlansComptes(method, request, env, path);
    if (path.match(/^\/api\/societes\/[^/]+\/plans-comptes\/[^/]+$/)) return handlePlansComptes(method, request, env, path);
    if (path.match(/^\/api\/societes\/[^/]+\/journaux$/)) return handleJournaux(method, request, env, path);
    if (path.match(/^\/api\/societes\/[^/]+\/journaux\/[^/]+$/)) return handleJournaux(method, request, env, path);
    if (path.match(/^\/api\/societes\/[^/]+\/dossiers$/)) return handleDossiers(method, request, env, path);
    if (path.match(/^\/api\/dossiers\/[^/]+$/) && method !== 'GET') return handleDossiers(method, request, env, path);
    if (path.match(/^\/api\/dossiers\/[^/]+\/pieces$/) && method === 'GET') return handlePieces(method, request, env, path);
    if (path.match(/^\/api\/dossiers\/[^/]+\/upload$/)) return handlePieces(method, request, env, path, ctx);
    if (path.match(/^\/api\/dossiers\/[^/]+\/extract$/)) return handlePieces(method, request, env, path, ctx);
    if (path.match(/^\/api\/dossiers\/[^/]+\/generate$/)) return handleEcritures(method, request, env, path, ctx);
    if (path.match(/^\/api\/dossiers\/[^/]+\/ecritures$/)) return handleEcritures(method, request, env, path);
    if (path.match(/^\/api\/dossiers\/[^/]+\/anomalies$/)) return handleAnomalies(method, request, env, path);
    if (path.match(/^\/api\/dossiers\/[^/]+\/export$/)) return handleExport(method, request, env, path);
    if (path.match(/^\/api\/pieces\/[^/]+$/)) return handlePieces(method, request, env, path);
    if (path.match(/^\/api\/ecritures\/[^/]+\/lignes$/)) return handleEcritures(method, request, env, path);
    if (path.match(/^\/api\/ecritures\/[^/]+$/)) return handleEcritures(method, request, env, path);
    if (path === '/api/dashboard') return handleDashboard(method, env);

    return error('Route not found', 404);
  } catch (e: any) {
    return error(e.message || 'Internal server error', 500);
  }
}
