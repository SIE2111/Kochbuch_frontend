import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabaseClient';

// TODO: echte Backend-URL eintragen, sobald deployed (z.B. Render/Fly.io)
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://meinkochbuch-backend-production.up.railway.app';

class ApiError extends Error {
  status: number;
  detail: string;
  // Manche Endpunkte liefern statt eines reinen Textes ein Objekt als
  // "detail" (z.B. POST /pool/{id}/fork bei 409: {message, local_recipe_id}) -
  // hier unveraendert mitgereicht, damit der Aufrufer bei Bedarf darauf
  // zugreifen kann, waehrend .detail selbst immer ein lesbarer String bleibt.
  data?: unknown;

  constructor(status: number, detail: string, data?: unknown) {
    super(detail);
    this.status = status;
    this.detail = detail;
    this.data = data;
  }
}

// 3-Monats-Testphase (siehe deps.py verify_supabase_jwt, Backend antwortet
// 402 auf JEDEM authentifizierten Endpunkt, sobald abgelaufen). Kein
// einzelner "erster Request nach Login" wie bei den anderen HomeArchive-
// Apps - hier faengt zentral apiFetch selbst jeden 402 ab und meldet ihn
// ueber diesen Callback, egal von welchem Screen aus der Request kam.
// AuthContext registriert sich hier (siehe dort) und zeigt den blockierenden
// Screen an.
let onTrialExpired: ((detail: string) => void) | null = null;
export function setOnTrialExpired(cb: ((detail: string) => void) | null) {
  onTrialExpired = cb;
}

/**
 * Zentrale Fetch-Hilfsfunktion: haengt automatisch das aktuelle Supabase-
 * JWT als Authorization-Header an, wirft eine ApiError mit lesbarer
 * Fehlermeldung bei nicht-2xx-Antworten (Backend liefert {"detail": "..."}).
 */
async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    let data: unknown;
    try {
      const body = await response.json();
      // FastAPI liefert detail meist als String, manchmal aber bewusst als
      // Objekt (siehe ApiError.data) - .detail bleibt dann trotzdem lesbar.
      if (typeof body.detail === 'string') {
        detail = body.detail;
      } else if (body.detail && typeof body.detail === 'object') {
        detail = body.detail.message ?? detail;
        data = body.detail;
      }
    } catch {
      // Antwort war kein JSON - Standardmeldung behalten
    }
    if (response.status === 402 && onTrialExpired) {
      onTrialExpired(detail);
    }
    throw new ApiError(response.status, detail, data);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  // DELETE mit optionalem Body - braucht z.B. /account, das die eigene
  // E-Mail als Bestaetigung erwartet. HTTP erlaubt einen Body bei DELETE,
  // FastAPI liest ihn auch; nur wurde er hier bisher nicht durchgereicht.
  delete: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),

  /**
   * Multipart-Upload fuer Bilder (siehe routers/images.py). Nutzt bewusst
   * kein JSON.stringify - FormData setzt seinen eigenen Content-Type-
   * Header inkl. Boundary automatisch, ein manuell gesetzter 'application/
   * json'-Header (wie in apiFetch) wuerde den Upload sonst kaputt machen,
   * daher hier ein eigener, schlankerer Fetch-Aufruf ohne den JSON-Header.
   */
  /**
   * Multipart-Upload fuer Bilder (siehe routers/images.py, routers/
   * ai_generation.py:scan-photo). Nutzt bewusst FileSystem.uploadAsync
   * statt manuell zusammengebauter FormData mit fetch() - React Natives
   * neuerer Netzwerk-Stack (ab RN 0.74+) unterstuetzt das klassische
   * {uri, name, type}-FormData-Part-Objekt nicht mehr und wirft dabei
   * "Unsupported FormDataPart implementation". FileSystem.uploadAsync
   * umgeht das, indem es die Datei direkt vom Dateisystem aus natives
   * Code hochlaedt.
   */
  /**
   * Mehrere Bilder in EINEM Aufruf auswerten lassen.
   *
   * Bewusst als JSON mit base64 statt als Multipart-Upload: React Natives
   * neuerer Netzwerk-Stack unterstuetzt das klassische
   * {uri, name, type}-FormData-Objekt nicht mehr und quittiert es mit
   * "Unsupported FormDataPart implementation" (siehe uploadImage unten).
   * Der bewaehrte Ausweg FileSystem.uploadAsync kann nur EINE Datei je
   * Aufruf - hier werden aber mehrere gebraucht, die GEMEINSAM ausgewertet
   * werden muessen, damit die KI Zutaten von Bild 1 und Schritte von
   * Bild 2 zu einem Rezept verbindet.
   *
   * Der Preis ist ein rund ein Drittel groesserer Transfer. Bei
   * hoechstens vier Fotos mit Qualitaet 0.8 ist das vertretbar.
   */
  uploadImagesAsJson: async <T>(
    path: string,
    files: { uri: string; type: string }[],
  ): Promise<T> => {
    const images: string[] = [];
    const mime_types: string[] = [];
    for (const f of files) {
      images.push(await FileSystem.readAsStringAsync(f.uri, { encoding: 'base64' }));
      mime_types.push(f.type);
    }
    return api.post<T>(path, { images, mime_types });
  },

  uploadImage: async (
    path: string,
    fileUri: string,
    fileName: string,
    mimeType: string,
    extraFields?: Record<string, string>,
  ): Promise<{ url: string; storage_warning?: string | null }> => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;

    const result = await FileSystem.uploadAsync(`${API_BASE_URL}${path}`, fileUri, {
      httpMethod: 'POST',
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'file',
      mimeType,
      parameters: extraFields ?? {},
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });

    if (result.status < 200 || result.status >= 300) {
      let detail = `HTTP ${result.status}`;
      try {
        const body = JSON.parse(result.body);
        detail = body.detail ?? detail;
      } catch {
        // Antwort war kein JSON
      }
      if (result.status === 402 && onTrialExpired) {
        onTrialExpired(detail);
      }
      throw new ApiError(result.status, detail);
    }
    return JSON.parse(result.body);
  },

  // Laedt eine Datei (z.B. das Rezept-PDF) authentifiziert vom Backend in
  // den lokalen Cache und gibt den lokalen file://-Pfad zurueck - von dort
  // kann sie z.B. per expo-sharing geteilt/gedruckt werden.
  downloadFile: async (path: string, localFileName: string): Promise<string> => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    const localUri = `${FileSystem.cacheDirectory}${localFileName}`;

    const result = await FileSystem.downloadAsync(`${API_BASE_URL}${path}`, localUri, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });

    if (result.status < 200 || result.status >= 300) {
      throw new ApiError(result.status, `HTTP ${result.status}`);
    }
    return result.uri;
  },
};

export { ApiError };
