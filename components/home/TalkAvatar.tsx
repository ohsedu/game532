"use client";

import { DEFAULT_AVATAR_URL, talkAvatarUrl } from "@/lib/talk";

/**
 * The signed-out face: a plain grey silhouette.
 *
 * Deliberately the same silhouette talk532 gives an account that has not
 * chosen a picture, so the two sites read as one login.
 */
export function GuestFace() {
  return (
    <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#e9ebf1" />
      <circle cx="16" cy="12.6" r="5.2" fill="#b9c0cf" />
      <path d="M4.8 29.5a11.2 11.2 0 0 1 22.4 0z" fill="#b9c0cf" />
    </svg>
  );
}

/**
 * Somebody's avatar, taken from their talk532 profile.
 *
 * A profile can still hold an emoji from before talk532 moved to picture
 * avatars — `talkAvatarUrl` returns null for those and the character is drawn
 * as text instead. onError covers the other direction: a preset filename this
 * app does not have a matching file for falls back to the silhouette rather
 * than leaving a broken image on screen.
 *
 * Shared by the header button and the message list, which draw the same faces
 * — the header its own, the list whoever wrote each line.
 */
export function MemberFace({
  icon,
  image,
}: {
  icon: string | null;
  image: string | null;
}) {
  const src = talkAvatarUrl(icon, image);

  if (!src) {
    return (
      <span className="flex h-full w-full items-center justify-center bg-surface-2 text-base">
        {icon}
      </span>
    );
  }

  return (
    // Not next/image: these are Supabase Storage paths and files served by
    // another origin, neither of which it can optimise.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="h-full w-full object-cover"
      decoding="async"
      onError={(e) => {
        const el = e.currentTarget;
        if (el.src !== DEFAULT_AVATAR_URL) el.src = DEFAULT_AVATAR_URL;
      }}
    />
  );
}
