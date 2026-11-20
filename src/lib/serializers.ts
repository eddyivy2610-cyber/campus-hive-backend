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
  logo: string | null;
  coverImage: string | null;
  storeType: string;
  isVerified: boolean;
  verificationType: string | null;
  vacationMode: boolean;
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
    logo: store.logo ?? null,
    coverImage: store.coverImage ?? null,
    storeType: store.storeType ?? "student_store",
    isVerified: Boolean(store.isVerified),
    verificationType: store.verificationType ?? null,
    vacationMode: Boolean(store.vacationMode),
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
  priceFormatted: string;
  category: string | null;
  campus: string | null;
  location: string | null;
  images: string[];
  condition: string | null;
  listingType: string;
  serviceDetails: any;
  slug: string | null;
  status: string;
  views: number;
  createdAt: Date | string;
}

export function toPublicListing(listing: any): PublicListingDTO {
  const numericPrice = Number(listing.price ?? 0);
  return {
    id: listing.id,
    storeId: listing.storeId,
    title: listing.title,
    description: listing.description ?? null,
    price: numericPrice,
    priceFormatted: `₦${Math.round(numericPrice).toLocaleString("en-NG")}`,
    category: listing.category ?? null,
    campus: listing.campus ?? null,
    location: listing.location ?? null,
    images: Array.isArray(listing.images) ? listing.images : [],
    condition: listing.condition ?? null,
    listingType: listing.listingType ?? "product",
    serviceDetails: listing.serviceDetails ?? null,
    slug: listing.slug ?? null,
    status: listing.status,
    views: Number(listing.views ?? 0),
    createdAt: listing.createdAt,
  };
}
