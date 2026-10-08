import type { ProviderId } from './catalog.js';

export interface AppCreds {
  id: string; // App ID / Client ID / Client key
  secret: string;
}

/** Disimpan terenkripsi di integrations.cred_enc. */
export interface Cred {
  accessToken: string;
  refreshToken?: string | null;
  /** epoch ms; null = tidak kedaluwarsa */
  expiresAt?: number | null;
}

export interface AccountOption {
  provider: ProviderId;
  accountId: string;
  name: string;
  type: string;
  cred: Cred;
  meta?: Record<string, unknown>;
}

export interface SyncedPost {
  externalId: string;
  caption: string;
  mediaType: string | null;
  permalink: string | null;
  publishedAt: Date;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  impressions: number;
  reach: number;
}

export interface SyncedReview {
  externalId: string;
  author: string;
  rating: number;
  text: string;
  reviewedAt: Date;
  replyText: string | null;
  repliedAt: Date | null;
}

export interface SyncOutput {
  metrics: { metric: string; dim: string; day: string; value: number }[];
  campaigns?: { externalId: string; name: string; objective: string | null; status: string; adIds: string[] }[];
  posts?: SyncedPost[];
  reviews?: SyncedReview[];
  note: string;
}
