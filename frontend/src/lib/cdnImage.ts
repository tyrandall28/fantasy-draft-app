const CLOUDINARY_UPLOAD = "/image/upload/";

// A Cloudinary transform segment is comma-joined `key_value` pairs, e.g.
// "f_auto,q_auto". Asset path segments ("league", "v1712345") never match, so
// this tells a transform we should replace from a path we must keep intact.
const TRANSFORM_SEGMENT = /^[a-z]+_[^/,]+(,[a-z]+_[^/,]+)*$/;

/**
 * Rewrite an nfl.com Cloudinary URL to fetch a square thumbnail.
 *
 * The URLs we store ship with `f_auto,q_auto` and no size constraint, so they
 * download at full resolution -- about 835 KB each. Putting the size into the
 * transform moves the resize to the CDN: the same headshot comes back at
 * roughly 1.4 KB. `g_face` face-crops so the head stays centred in a square.
 *
 * Returns null for anything that isn't a Cloudinary URL, so callers can fall
 * back rather than load an image of unknown size.
 */
export function cdnThumb(url: string, px: number): string | null {
  const at = url.indexOf(CLOUDINARY_UPLOAD);
  if (at === -1) return null;
  const head = url.slice(0, at + CLOUDINARY_UPLOAD.length);
  const rest = url.slice(at + CLOUDINARY_UPLOAD.length);

  const slash = rest.indexOf("/");
  const first = slash === -1 ? rest : rest.slice(0, slash);
  // Only drop the leading segment when it really is a transform. Dropping it
  // blindly would eat the "league/" prefix on a URL that ships without one.
  const asset =
    slash !== -1 && TRANSFORM_SEGMENT.test(first) ? rest.slice(slash + 1) : rest;
  if (!asset) return null;

  return `${head}f_auto,q_auto,w_${px},h_${px},c_fill,g_face/${asset}`;
}
