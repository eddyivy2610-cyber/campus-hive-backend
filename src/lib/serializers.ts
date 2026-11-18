/**
 * Explicit public DTO mappers to ensure internal fields (ownerId, passwordHash,
 * tokenVersion, otpHash, etc.) are never serialized in public responses.
 */

export interface PublicStoreDTO {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  campus: string | null;
  operatingLocation: string | null;
  status: string;
  followersCount: number;
  metrics: {
    rating: number;
    reviewsCount: number;
  };
  createdAt: Date | string;
}

export function toPublicStore(
  store: any,
  metrics?: { rating?: number; reviewsCount?: number }
): PublicStoreDTO {
  return {
    id: store.id,
    name: store.name,
    slug: store.slug,
    description: store.description ?? null,
    category: store.category ?? null,
    campus: store.campus ?? null,
    operatingLocation: store.operatingLocation ?? null,
    status: store.status,
    followersCount: Number(store.followersCount ?? 0),
    metrics: {
      rating: metrics?.rating ?? 5,
      reviewsCount: metrics?.reviewsCount ?? 0,
    },
    createdAt: store.createdAt,
  };
}

export interface PublicListingDTO {
  id: string;
  storeId: string;
  title: string;
  description: string | null;
  price: number;
  category: string | null;
  campus: string | null;
  location: string | null;
  status: string;
  createdAt: Date | string;
}

export function toPublicListing(listing: any): PublicListingDTO {
  return {
    id: listing.id,
    storeId: listing.storeId,
    title: listing.title,
    description: listing.description ?? null,
    price: Number(listing.price ?? 0),
    category: listing.category ?? null,
    campus: listing.campus ?? null,
    location: listing.location ?? null,
    status: listing.status,
    createdAt: listing.createdAt,
  };
}
