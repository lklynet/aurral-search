import {
  exactNameMatch,
  isShadowArtist,
  isWeakAlbumMatch,
} from "./match.js";

function popularity(item) {
  return item.popularity || 0;
}

function rank(item) {
  return item.score || 0;
}

function compareRank(left, right) {
  const rankDelta = rank(right) - rank(left);
  if (Math.abs(rankDelta) > 0.001) return rankDelta;
  return popularity(right) - popularity(left);
}

export function filterCatalog(query, catalog) {
  const albums = (catalog.albums || []).filter(
    (album) => !isWeakAlbumMatch(query, album),
  );
  const artists = (catalog.artists || []).filter(
    (artist) => !isShadowArtist(artist, query, albums),
  );
  return {
    artists,
    albums,
    tracks: catalog.tracks || [],
  };
}

export function pickTopResult(query, catalog) {
  const artists = catalog.artists || [];
  const albums = catalog.albums || [];
  const tracks = catalog.tracks || [];

  const exactArtist = artists.find((artist) => exactNameMatch(query, artist.name));
  if (exactArtist) return exactArtist;

  const exactAlbum = albums.find((album) => exactNameMatch(query, album.title));
  if (exactAlbum) return exactAlbum;

  const exactTrack = tracks.find((track) => exactNameMatch(query, track.title));
  if (exactTrack) return exactTrack;

  const candidates = [...tracks, ...albums, ...artists].sort(compareRank);
  return candidates[0] || null;
}
