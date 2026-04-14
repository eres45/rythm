import { ChevronDown, Download, FolderPlus, Heart, Home, ImagePlus, ListMusic, ListPlus, Maximize2, Mic2, Minimize2, Pause, Pencil, Play, Search, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Trash2, UserRound, Volume2, VolumeX, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from './lib/supabase';

type Song = {
  id: string;
  title: string;
  artist: string;
  cover: string;
  coverFallback?: string;
  durationSec?: number;
  streams?: string;
  album?: string;
  trendBucket?: string;
  viewCountRaw?: number;
  audioCandidates?: string[];
  sourceType?: 'saavn';
};
type ResolvedStream = {
  url: string;
  directUrl: string;
  viaProxy: boolean;
  durationSec: number;
  base: string;
};
type PersistedPlayerState = {
  version: 3;
  currentTrack: Song | null;
  currentTimeSec: number;
  wasPlaying: boolean;
  volume: number;
  isMuted: boolean;
  isShuffle: boolean;
  likedTrackIds: string[];
  likedSongs: Song[];
  playlists: Playlist[];
  selectedPlaylistId: string | null;
  queuedTrackIds: string[];
};
type StoredPlayerState = Partial<Omit<PersistedPlayerState, 'version'>> & { version?: number };
type CloudStateRow = {
  user_id: string;
  state: StoredPlayerState;
  updated_at?: string;
};
type AuthSession = {
  user: {
    id: string;
    email: string;
  };
};
type Playlist = {
  id: string;
  name: string;
  cover?: string;
  description?: string;
  songs: Song[];
  createdAt: number;
};

type SaavnImage = {
  quality?: string;
  url?: string;
};

type SaavnArtist = {
  name?: string;
};

type SaavnSong = {
  id?: string;
  name?: string;
  title?: string;
  duration?: number | string;
  playCount?: number | string;
  image?: SaavnImage[] | string;
  album?: { name?: string } | string;
  artists?: {
    primary?: SaavnArtist[];
    all?: SaavnArtist[];
  };
  primaryArtists?: string;
  singers?: string;
  downloadUrl?: Array<{ quality?: string; url?: string }>;
};

const chips = ['Arijit Singh', 'Pritam', 'Diljit Dosanjh', 'AP Dhillon', 'Shreya Ghoshal', 'A.R. Rahman'];
const trendSources = [
  { label: 'Top Bollywood Hits', query: 'top bollywood hits songs' },
  { label: 'India Music Charts', query: 'spotify india top songs' },
  { label: 'Bollywood Hits', query: 'new bollywood songs 2026' },
  { label: 'Instagram Viral', query: 'instagram viral hindi songs' },
  { label: 'Punjabi Hits', query: 'top punjabi songs' },
];

const saavnBase = 'https://saavn.sumit.co/api';
const DEBUG_AUDIO = true;
const VIS_BAR_COUNT = 46;
const PLAYER_STATE_STORAGE_KEY = 'rythm.player.state.v1';
const TEST_AUTH_STORAGE_KEY = 'rythm.test.auth.session.v1';
const USE_TEST_AUTH = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_USE_TEST_AUTH !== 'false';
const LIKED_LIBRARY_COVER = 'https://picsum.photos/seed/lib1/60/60';
const PLAYLIST_LIBRARY_COVER = 'https://picsum.photos/seed/lib2/60/60';

function App() {
  const [view, setView] = useState<'home' | 'search' | 'liked' | 'playlist' | 'playlist-editor'>('home');
  const [libraryTab, setLibraryTab] = useState<'liked' | 'playlists'>('liked');

  const [topPicks, setTopPicks] = useState<Song[]>([]);
  const [trending, setTrending] = useState<Song[]>([]);
  const [essentials, setEssentials] = useState<Song[]>([]);
  const [newReleases, setNewReleases] = useState<Song[]>([]);

  const [searchQuery, setSearchQuery] = useState('arijit singh');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchTab, setSearchTab] = useState<'all' | 'songs' | 'albums' | 'artists'>('all');

  const [activeSource, setActiveSource] = useState('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('Connecting to music sources...');
  const [error, setError] = useState('');

  const [currentTrack, setCurrentTrack] = useState<Song | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [likedTrackIds, setLikedTrackIds] = useState<Set<string>>(new Set());
  const [likedSongStore, setLikedSongStore] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [playlistNameDraft, setPlaylistNameDraft] = useState('');
  const [playlistEditorMode, setPlaylistEditorMode] = useState<'create' | 'edit'>('create');
  const [editorPlaylistId, setEditorPlaylistId] = useState<string | null>(null);
  const [editorName, setEditorName] = useState('');
  const [editorDescription, setEditorDescription] = useState('');
  const [editorCover, setEditorCover] = useState('');
  const [queuedTrackIds, setQueuedTrackIds] = useState<string[]>([]);
  const [volume, setVolume] = useState(0.8);
  const [isMuted, setIsMuted] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isExpandedPlayer, setIsExpandedPlayer] = useState(false);
  const [repeatMode] = useState<'off' | 'all' | 'one'>('all');
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [isHydratingFromCloud, setIsHydratingFromCloud] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authError, setAuthError] = useState('');
  const [cloudSyncStatus, setCloudSyncStatus] = useState('');

  const audioRef = useRef<HTMLAudioElement>(null);
  const probeAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamCacheRef = useRef<Map<string, ResolvedStream>>(new Map());
  const invalidTrackRef = useRef<Set<string>>(new Set());
  const selectingRef = useRef(false);
  const requestSeqRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const freqDataRef = useRef<Uint8Array | null>(null);
  const realVizReadyRef = useRef(false);
  const vizAgcRef = useRef(120);
  const pendingRestoreRef = useRef<StoredPlayerState | null>(null);
  const restoreAttemptedRef = useRef(false);
  const hasRestoredTrackRef = useRef(false);
  const playlistCoverInputRef = useRef<HTMLInputElement | null>(null);
  const editorCoverInputRef = useRef<HTMLInputElement | null>(null);
  const cloudSaveTimerRef = useRef<number | null>(null);
  const isApplyingCloudStateRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const vizBarsRef = useRef<number[]>(Array.from({ length: VIS_BAR_COUNT }, () => 18));
  const [vizBars, setVizBars] = useState<number[]>(
    () => Array.from({ length: VIS_BAR_COUNT }, () => 18),
  );

  const queue = useMemo(() => {
    const playlistSongs = playlists.flatMap((playlist) => playlist.songs);
    const merged = [...topPicks, ...trending, ...essentials, ...newReleases, ...searchResults, ...likedSongStore, ...playlistSongs];
    const map = new Map<string, Song>();
    for (const song of merged) {
      if (!map.has(song.id)) {
        map.set(song.id, song);
      }
    }
    if (currentTrack && !map.has(currentTrack.id)) {
      map.set(currentTrack.id, currentTrack);
    }
    return [...map.values()];
  }, [topPicks, trending, essentials, newReleases, searchResults, likedSongStore, playlists, currentTrack]);

  const likedSongs = useMemo(() => {
    const index = new Map<string, Song>();
    for (const song of queue) {
      index.set(song.id, song);
    }
    for (const song of likedSongStore) {
      if (!index.has(song.id)) {
        index.set(song.id, song);
      }
    }
    const ordered = [...likedTrackIds]
      .map((id) => index.get(id))
      .filter((song): song is Song => Boolean(song));
    return ordered;
  }, [likedTrackIds, queue, likedSongStore]);

  const topSearchResult = searchResults[0] || null;
  const selectedPlaylist = useMemo(
    () => playlists.find((playlist) => playlist.id === selectedPlaylistId) || null,
    [playlists, selectedPlaylistId],
  );

  useEffect(() => {
    setPlaylistNameDraft(selectedPlaylist?.name || '');
  }, [selectedPlaylist?.id, selectedPlaylist?.name]);
  const uniqueAlbums = useMemo(
    () => dedupeByLabel(searchResults.map((s) => s.album || 'Unknown Album')),
    [searchResults],
  );
  const uniqueArtists = useMemo(
    () => dedupeByLabel(searchResults.map((s) => s.artist || 'Unknown Artist')),
    [searchResults],
  );

  const cloudTableName = USE_TEST_AUTH ? 'test_user_states' : 'user_states';

  function readTestSession(): AuthSession | null {
    if (typeof window === 'undefined') {
      return null;
    }
    try {
      const raw = window.localStorage.getItem(TEST_AUTH_STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as AuthSession;
      if (!parsed?.user?.id || !parsed.user.email) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function writeTestSession(next: AuthSession | null) {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      if (!next) {
        window.localStorage.removeItem(TEST_AUTH_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(TEST_AUTH_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures.
    }
  }

  async function hashPassword(value: string): Promise<string> {
    if (typeof window === 'undefined' || !window.crypto?.subtle) {
      return value;
    }
    const data = new TextEncoder().encode(value);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function applyStoredState(parsed: StoredPlayerState) {
    setVolume(clamp01(Number(parsed.volume ?? 0.8)));
    setIsMuted(Boolean(parsed.isMuted));
    setIsShuffle(Boolean(parsed.isShuffle));
    setLikedTrackIds(new Set((parsed.likedTrackIds || []).filter(Boolean)));
    setLikedSongStore(
      Array.isArray(parsed.likedSongs)
        ? (parsed.likedSongs || []).filter((song): song is Song => Boolean(song?.id))
        : [],
    );
    setPlaylists(
      Array.isArray(parsed.playlists)
        ? parsed.playlists
            .filter((playlist): playlist is Playlist => Boolean(playlist?.id && playlist?.name))
            .map((playlist) => ({
              id: playlist.id,
              name: playlist.name,
              cover: typeof playlist.cover === 'string' ? playlist.cover : undefined,
              description: typeof playlist.description === 'string' ? playlist.description : '',
              createdAt: Number(playlist.createdAt || Date.now()),
              songs: Array.isArray(playlist.songs)
                ? playlist.songs.filter((song): song is Song => Boolean(song?.id))
                : [],
            }))
        : [],
    );
    setSelectedPlaylistId(typeof parsed.selectedPlaylistId === 'string' ? parsed.selectedPlaylistId : null);
    setQueuedTrackIds((parsed.queuedTrackIds || []).filter(Boolean));

    if (parsed.currentTrack?.id) {
      setCurrentTrack(parsed.currentTrack);
      setDuration(parsed.currentTrack.durationSec || 0);
      setCurrentTime(Math.max(0, Number(parsed.currentTimeSec || 0)));
      hasRestoredTrackRef.current = true;
      pendingRestoreRef.current = parsed;
    }
  }

  const persistedPayload = useMemo<PersistedPlayerState>(() => ({
    version: 3,
    currentTrack,
    currentTimeSec: Math.max(0, Math.floor(currentTime)),
    wasPlaying: isPlaying,
    volume: clamp01(volume),
    isMuted,
    isShuffle,
    likedTrackIds: [...likedTrackIds],
    likedSongs: likedSongs.filter((song) => likedTrackIds.has(song.id)),
    playlists,
    selectedPlaylistId,
    queuedTrackIds,
  }), [
    currentTrack,
    Math.floor(currentTime),
    isPlaying,
    volume,
    isMuted,
    isShuffle,
    likedTrackIds,
    likedSongs,
    playlists,
    selectedPlaylistId,
    queuedTrackIds,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const raw = window.localStorage.getItem(PLAYER_STATE_STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as StoredPlayerState;
      if (!parsed || (typeof parsed.version === 'number' && ![1, 2, 3].includes(parsed.version))) {
        return;
      }
      applyStoredState(parsed);
    } catch {
      // Ignore corrupted local storage state.
    }
  }, []);

  useEffect(() => {
    if (USE_TEST_AUTH) {
      const stored = readTestSession();
      setSession(stored);
      setAuthReady(true);
      return;
    }

    if (!supabase) {
      setAuthReady(true);
      return;
    }

    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) {
        return;
      }
      if (data.session?.user?.id && data.session.user.email) {
        setSession({ user: { id: data.session.user.id, email: data.session.user.email } });
      } else {
        setSession(null);
      }
      setAuthReady(true);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (nextSession?.user?.id && nextSession.user.email) {
        setSession({ user: { id: nextSession.user.id, email: nextSession.user.email } });
      } else {
        setSession(null);
      }
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !session?.user?.id) {
      return;
    }

    let cancelled = false;
    setIsHydratingFromCloud(true);
    setCloudSyncStatus('Syncing your library...');

    void (async () => {
      try {
        const { data, error: fetchError } = await supabase
          .from(cloudTableName)
          .select('user_id,state,updated_at')
          .eq('user_id', session.user.id)
          .maybeSingle<CloudStateRow>();

        if (fetchError) {
          throw fetchError;
        }
        if (cancelled) {
          return;
        }

        if (data?.state && typeof data.state === 'object') {
          isApplyingCloudStateRef.current = true;
          applyStoredState(data.state);
          isApplyingCloudStateRef.current = false;
          setCloudSyncStatus('Synced from cloud');
        } else {
          setCloudSyncStatus('No cloud backup found yet');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Cloud sync failed';
        setCloudSyncStatus(`Cloud sync failed: ${msg}`);
      } finally {
        if (!cancelled) {
          setIsHydratingFromCloud(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  useEffect(() => {
    void loadMusicHome();
  }, []);

  useEffect(() => {
    if (!probeAudioRef.current) {
      const probe = new Audio();
      probe.preload = 'metadata';
      probeAudioRef.current = probe;
    }
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.muted = isMuted;
  }, [volume, isMuted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const onTime = () => setCurrentTime(audio.currentTime || 0);
    const onDuration = () => setDuration(audio.duration || currentTrack?.durationSec || 0);
    const onEnded = () => {
      if (repeatMode === 'one' && currentTrack) {
        void selectTrack(currentTrack);
        return;
      }
      playNext();
    };

    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('ended', onEnded);
    };
  }, [currentTrack, queue, repeatMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(PLAYER_STATE_STORAGE_KEY, JSON.stringify(persistedPayload));
    } catch {
      // Ignore quota/storage failures.
    }
  }, [
    persistedPayload,
  ]);

  useEffect(() => {
    if (!supabase || !session?.user?.id || isHydratingFromCloud || isApplyingCloudStateRef.current) {
      return;
    }
    const supabaseClient = supabase;

    if (cloudSaveTimerRef.current !== null) {
      window.clearTimeout(cloudSaveTimerRef.current);
    }

    const cloudPayload: PersistedPlayerState = {
      ...persistedPayload,
      currentTimeSec: Math.max(0, Math.floor(persistedPayload.currentTimeSec / 5) * 5),
    };

    cloudSaveTimerRef.current = window.setTimeout(() => {
      void (async () => {
        const { error: upsertError } = await supabaseClient
          .from(cloudTableName)
          .upsert(
            {
              user_id: session.user.id,
              state: cloudPayload,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' },
          );

        if (upsertError) {
          setCloudSyncStatus(`Cloud save failed: ${upsertError.message}`);
          return;
        }
        setCloudSyncStatus('Cloud backup saved');
      })();
    }, 1600);

    return () => {
      if (cloudSaveTimerRef.current !== null) {
        window.clearTimeout(cloudSaveTimerRef.current);
        cloudSaveTimerRef.current = null;
      }
    };
  }, [persistedPayload, session?.user?.id, isHydratingFromCloud]);
  useEffect(() => {
    if (!isExpandedPlayer) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExpandedPlayer(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExpandedPlayer]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        const isEditable = target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        if (isEditable) {
          return;
        }
      }

      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      switch (event.code) {
        case 'Space': {
          event.preventDefault();
          void togglePlay();
          break;
        }
        case 'ArrowRight': {
          if (!duration) return;
          event.preventDefault();
          seekTo(Math.min(1, (currentTime + 5) / duration));
          break;
        }
        case 'ArrowLeft': {
          if (!duration) return;
          event.preventDefault();
          seekTo(Math.max(0, (currentTime - 5) / duration));
          break;
        }
        case 'ArrowUp': {
          event.preventDefault();
          setIsMuted(false);
          setVolume((prev) => Math.min(1, prev + 0.05));
          break;
        }
        case 'ArrowDown': {
          event.preventDefault();
          setVolume((prev) => {
            const next = Math.max(0, prev - 0.05);
            setIsMuted(next === 0);
            return next;
          });
          break;
        }
        case 'KeyM': {
          event.preventDefault();
          setIsMuted((prev) => !prev);
          break;
        }
        case 'KeyF': {
          event.preventDefault();
          setIsExpandedPlayer((prev) => !prev);
          break;
        }
        case 'Escape': {
          if (isExpandedPlayer) {
            event.preventDefault();
            setIsExpandedPlayer(false);
          }
          break;
        }
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentTime, duration, isExpandedPlayer]);

  useEffect(() => {
    if (!isExpandedPlayer) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      vizAgcRef.current = 120;
      const idle = Array.from({ length: VIS_BAR_COUNT }, () => 18);
      vizBarsRef.current = idle;
      setVizBars(idle);
      return;
    }

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (typeof window !== 'undefined') {
      const AudioCtxCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxCtor && !audioCtxRef.current) {
        try {
          const ctx = new AudioCtxCtor();
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          analyser.smoothingTimeConstant = 0.82;

          const source = ctx.createMediaElementSource(audio);
          source.connect(analyser);
          analyser.connect(ctx.destination);

          audioCtxRef.current = ctx;
          analyserRef.current = analyser;
          mediaSourceRef.current = source;
          freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
        } catch {
          realVizReadyRef.current = false;
        }
      }
    }

    const trackSeed = hashString(`${currentTrack?.id || ''}|${currentTrack?.title || ''}`) || 1;
    const halfCount = VIS_BAR_COUNT / 2;
    const bpm = 92 + (trackSeed % 54); // 92-145 keeps motion club-like without being chaotic.
    const beatHz = bpm / 60;

    const tick = () => {
      const t = audio.currentTime || 0;
      const isActive = !audio.paused && !audio.ended;
      let nextRaw: number[] | null = null;

      const analyser = analyserRef.current;
      const data = freqDataRef.current;
      if (isActive && analyser && data) {
        (analyser as any).getByteFrequencyData(data);
        let energy = 0;
        for (let i = 0; i < data.length; i += 1) {
          energy += data[i];
        }
        const avgEnergy = energy / Math.max(1, data.length);
        const looksReal = avgEnergy > 1.2;
        if (looksReal) {
          realVizReadyRef.current = true;
          const effectiveBins = Math.max(12, Math.floor(data.length * 0.92));
          const bandAverages = Array.from({ length: halfCount }, (_, i) => {
            const from = i / halfCount;
            const to = (i + 1) / halfCount;
            const start = Math.max(0, Math.floor(Math.pow(from, 1.85) * effectiveBins));
            const end = Math.min(data.length, Math.max(start + 1, Math.floor(Math.pow(to, 1.85) * effectiveBins)));

            let total = 0;
            for (let j = start; j < end; j += 1) {
              const bin = data[j];
              total += bin;
            }
            return total / Math.max(1, end - start);
          });

          let loudestBand = 0;
          for (let i = 0; i < bandAverages.length; i += 1) {
            if (bandAverages[i] > loudestBand) {
              loudestBand = bandAverages[i];
            }
          }
          const targetAgc = Math.max(36, loudestBand);
          const currentAgc = vizAgcRef.current;
          const agcStep = targetAgc > currentAgc ? 0.08 : 0.02;
          const nextAgc = currentAgc + (targetAgc - currentAgc) * agcStep;
          vizAgcRef.current = nextAgc;

          const halfBars = bandAverages.map((avg, i) => {
            const edgeWeight = 1 - i / Math.max(1, halfCount - 1);
            const normalized = Math.max(0, (avg - 4) / (nextAgc * 0.95 + 1));
            const compressed = Math.pow(Math.min(1, normalized), 0.72);
            const pulse = Math.max(0, (avgEnergy - 12) / 140) * 8;
            const base = 8 + compressed * (40 + edgeWeight * 24) + pulse + edgeWeight * 5;
            const dynamicMax = 52 + edgeWeight * 26;
            return Math.min(dynamicMax, Math.max(10, base));
          });
          nextRaw = [...halfBars.slice().reverse(), ...halfBars];
        }
      }

      if (!nextRaw) {
        const halfBars = Array.from({ length: halfCount }, (_, i) => {
          if (audio.paused || audio.ended) {
            const idlePulse = 1 + 0.35 * Math.sin(t * 1.2 + i * 0.24);
            return 14 + ((i % 6) * 1.1) * idlePulse;
          }

          const edgeWeight = 1 - i / Math.max(1, halfCount - 1);
          const centerWeight = 1 - edgeWeight;
          const beat = (t * beatHz) % 1;
          const kick = Math.exp(-beat * 13);
          const snareBeat = (beat + 0.5) % 1;
          const snare = Math.exp(-snareBeat * 18);
          const hat = Math.max(0, Math.sin((t * beatHz * 2 + i * 0.19) * Math.PI * 2));

          const lowWeight = edgeWeight;
          const midWeight = centerWeight * 0.85;
          const highWeight = centerWeight * 0.55;

          const groove = Math.sin((t * (1.8 + (trackSeed % 5) * 0.22) + i * 0.13) * Math.PI * 2);
          const bassOsc = (Math.sin((t * beatHz + i * 0.09) * Math.PI * 2) + 1) * 0.5;
          const perBarFlavor = Math.sin((t * 3.8) + i * (0.2 + (trackSeed % 7) * 0.01));

          const height =
            12 +
            lowWeight * (kick * 50 + bassOsc * 14) +
            midWeight * (snare * 17 + (groove + 1) * 6) +
            highWeight * (hat * 8 + (perBarFlavor + 1) * 3);

          const dynamicMax = 50 + edgeWeight * 20;
          return Math.min(dynamicMax, Math.max(14, height));
        });
        nextRaw = [...halfBars.slice().reverse(), ...halfBars];
      }

      const prev = vizBarsRef.current;
      const next = nextRaw.map((target, i) => {
        const from = prev[i] ?? 18;
        const edgeWeight = Math.min(1, Math.abs((i + 0.5) / VIS_BAR_COUNT - 0.5) * 2);
        const attack = isActive ? 0.72 - edgeWeight * 0.08 : 0.36;
        const release = isActive ? 0.16 + edgeWeight * 0.08 : 0.2;
        const smoothing = target > from ? attack : release;
        return from + (target - from) * smoothing;
      });
      vizBarsRef.current = next;
      setVizBars(next);
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isExpandedPlayer, isPlaying, currentTrack?.id]);

  useEffect(() => {
    if (loading || restoreAttemptedRef.current) {
      return;
    }
    const snapshot = pendingRestoreRef.current;
    if (!snapshot?.currentTrack?.id) {
      return;
    }
    restoreAttemptedRef.current = true;

    void (async () => {
      const song = snapshot.currentTrack as Song;
      const audio = audioRef.current;
      if (!audio) {
        return;
      }

      try {
        const resolved = await resolvePlayableStream(song);
        setActiveSource(resolved.base);
        setAudioUrl(resolved.directUrl);
        setDuration(resolved.durationSec || song.durationSec || 0);
        setCurrentTrack(song);

        audio.pause();
        audio.src = resolved.url;
        audio.currentTime = 0;
        audio.load();
        try {
          await waitForAudioReady(audio, 12000);
        } catch {
          // Continue; some streams don't emit metadata reliably.
        }

        const desiredTime = Math.max(0, Number(snapshot.currentTimeSec || 0));
        if (desiredTime > 0) {
          const maxTime = Number.isFinite(audio.duration) && audio.duration > 0.5
            ? Math.max(0, audio.duration - 0.25)
            : desiredTime;
          audio.currentTime = Math.min(desiredTime, maxTime);
        }
        setCurrentTime(audio.currentTime || desiredTime);

        if (Boolean(snapshot.wasPlaying)) {
          try {
            await audio.play();
            setIsPlaying(true);
            setStatus(`Resumed: ${song.title}`);
          } catch {
            setIsPlaying(false);
            setStatus(`Ready to resume: ${song.title}`);
          }
        } else {
          setIsPlaying(false);
          setStatus(`Restored: ${song.title}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to restore previous track';
        setStatus(msg);
      } finally {
        pendingRestoreRef.current = null;
      }
    })();
  }, [loading]);

  async function loadMusicHome() {
    setLoading(true);
    setError('');

    try {
      const [playlistResp, arijitResp, releaseResp, ...trendResponses] = await Promise.all([
        fetchSaavn('/playlists?id=110858205'),
        fetchSaavn('/search/songs?query=arijit%20singh%20best&page=0&limit=24'),
        fetchSaavn('/search/songs?query=new%20bollywood%20songs%202026&page=0&limit=24'),
        ...trendSources.map((source) =>
          fetchSaavn(`/search/songs?query=${encodeURIComponent(source.query)}&page=0&limit=18`),
        ),
      ]);

      const nativeTrending = mapSaavnSongs(extractSaavnPlaylistSongs(playlistResp.data))
        .filter(isLikelyActualSong)
        .slice(0, 10)
        .map((song) => ({ ...song, trendBucket: 'India Music Trending' }));

      const bucketedTrending: Song[] = trendResponses.flatMap((resp, idx) =>
        mapSaavnSongs(extractSaavnSearchResults(resp.data))
          .filter(isLikelyActualSong)
          .sort((a, b) => (b.viewCountRaw || 0) - (a.viewCountRaw || 0))
          .slice(0, 4)
          .map((song) => ({ ...song, trendBucket: trendSources[idx]?.label || 'Trending' })),
      );

      const trendingSongs = dedupeSongs([...nativeTrending, ...bucketedTrending])
        .filter(isLikelyActualSong)
        .slice(0, 16);
      const arijitSongs = mapSaavnSongs(extractSaavnSearchResults(arijitResp.data)).slice(0, 12);
      const releaseSongs = mapSaavnSongs(extractSaavnSearchResults(releaseResp.data)).slice(0, 12);

      const usableTrending = trendingSongs;
      const firstWorkingTrend = [playlistResp, ...trendResponses][0];

      setActiveSource(firstWorkingTrend?.base || saavnBase);
      setTopPicks(usableTrending.slice(0, 6));
      setTrending(usableTrending.slice(0, 8));
      setEssentials(arijitSongs);
      setNewReleases(releaseSongs);

      const initialTrack = usableTrending[0] ?? arijitSongs[0] ?? releaseSongs[0] ?? null;
      if (initialTrack && !hasRestoredTrackRef.current) {
        setCurrentTrack(initialTrack);
        setDuration(initialTrack.durationSec || 0);
      }

      // Warm a small playable cache so first taps are faster.
      void warmPlayableCache(usableTrending.slice(0, 4));

      setStatus('Live music feed loaded from Saavn.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load music feed.';
      setError(message);
      setStatus('Source unavailable right now.');
    } finally {
      setLoading(false);
    }
  }

  async function runSearch(query: string) {
    const clean = query.trim();
    if (!clean) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    setSearchError('');

    try {
      const resp = await fetchSaavn(`/search/songs?query=${encodeURIComponent(clean)}&page=0&limit=40`);
      const sourceBase = resp.base;
      const songs = mapSaavnSongs(extractSaavnSearchResults(resp.data))
        .filter(isLikelyActualSong)
        .slice(0, 36);

      setActiveSource(sourceBase);
      setSearchResults(songs);
      setSearchTab('all');
      setStatus(`Search results from ${new URL(sourceBase).hostname}`);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearchLoading(false);
    }
  }

  async function selectTrack(song: Song) {
    const requestId = ++requestSeqRef.current;
    if (selectingRef.current) {
      if (DEBUG_AUDIO) {
        console.debug('[player] selectTrack skipped (busy)', song.id);
      }
      return;
    }
    selectingRef.current = true;

    if (DEBUG_AUDIO) {
      console.groupCollapsed('[player] selectTrack');
      console.debug('track', song);
      console.groupEnd();
    }
    setCurrentTrack(song);
    setStatus(`Loading stream for ${song.title}...`);
    setCurrentTime(0);

    try {
      const resolved = await resolvePlayableStream(song);
      if (requestId !== requestSeqRef.current) {
        return;
      }
      await startPlayback(song, resolved);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Playback failed.';
      invalidTrackRef.current.add(song.id);
      setIsPlaying(false);
      setStatus(`${message} Trying next playable track...`);
      if (DEBUG_AUDIO) {
        console.error('[player] selectTrack failed', err);
      }
      const moved = await playNextAvailable(song.id, 10);
      if (!moved) {
        setStatus(`No playable tracks found right now. Last error: ${message}`);
      }
    } finally {
      selectingRef.current = false;
    }
  }

  async function togglePlay() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    if (!currentTrack && queue[0]) {
      await selectTrack(queue[0]);
      return;
    }

    if (!audioUrl && currentTrack) {
      await selectTrack(currentTrack);
      return;
    }

    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
      setStatus('Paused');
    } else {
      try {
        await audio.play();
        setIsPlaying(true);
        setStatus(`Now playing: ${currentTrack?.title ?? 'Track'}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Playback blocked.';
        setStatus(`Playback blocked: ${msg}`);
      }
    }
  }

  function playNext() {
    if (!queue.length || !currentTrack) {
      return;
    }
    const queuedNextId = queuedTrackIds.find((id) => id !== currentTrack.id && queue.some((song) => song.id === id));
    if (queuedNextId) {
      const queuedSong = queue.find((song) => song.id === queuedNextId);
      if (queuedSong) {
        setQueuedTrackIds((prev) => prev.filter((id) => id !== queuedNextId));
        void selectTrack(queuedSong);
        return;
      }
    }

    if (isShuffle) {
      const shuffled = queue.filter((song) => song.id !== currentTrack.id && !invalidTrackRef.current.has(song.id));
      if (shuffled.length > 0) {
        const nextRandom = shuffled[Math.floor(Math.random() * shuffled.length)];
        void selectTrack(nextRandom);
        return;
      }
    }
    const idx = queue.findIndex((item) => item.id === currentTrack.id);
    if (idx === queue.length - 1 && repeatMode === 'off') {
      setIsPlaying(false);
      setStatus('Playback finished');
      return;
    }
    const next = queue[(idx + 1 + queue.length) % queue.length];
    void selectTrack(next);
  }

  function playPrev() {
    if (!queue.length || !currentTrack) {
      return;
    }
    const idx = queue.findIndex((item) => item.id === currentTrack.id);
    const prev = queue[(idx - 1 + queue.length) % queue.length];
    void selectTrack(prev);
  }

  function seekTo(ratio: number) {
    const audio = audioRef.current;
    if (!audio || !duration) {
      return;
    }
    const time = Math.max(0, Math.min(duration, duration * ratio));
    audio.currentTime = time;
    setCurrentTime(time);
  }

  async function startPlayback(song: Song, resolved: ResolvedStream): Promise<void> {
    const audio = audioRef.current;
    if (!audio) {
      throw new Error('Audio device unavailable');
    }

    setActiveSource(resolved.base);
    setAudioUrl(resolved.directUrl);
    setDuration(resolved.durationSec || song.durationSec || 0);

    audio.pause();
    audio.src = resolved.url;
    audio.currentTime = 0;
    audio.load();
    try {
      await audio.play();
    } catch (err) {
      if (!resolved.viaProxy || !resolved.directUrl || resolved.directUrl === resolved.url) {
        throw err;
      }
      audio.pause();
      audio.src = resolved.directUrl;
      audio.currentTime = 0;
      audio.load();
      await audio.play();
    }
    vizAgcRef.current = 120;
    if (audioCtxRef.current?.state === 'suspended') {
      void audioCtxRef.current.resume();
    }
    setIsPlaying(true);
    setCurrentTrack(song);
    setStatus(`Now playing: ${song.title}`);
  }

  async function resolvePlayableStream(song: Song): Promise<ResolvedStream> {
    const cached = streamCacheRef.current.get(song.id);
    if (cached) {
      if (DEBUG_AUDIO) {
        console.debug('[audio] cache hit', song.id);
      }
      return cached;
    }

    const probe = probeAudioRef.current;
    if (!probe) {
      throw new Error('Audio probe unavailable');
    }

    let lastError = 'No playable sources';
    const directCandidates = (song.audioCandidates || []).filter(Boolean);

    if (directCandidates.length) {
      for (let i = 0; i < directCandidates.length; i += 1) {
        const candidateUrl = directCandidates[i];
        const playbackUrl = toPlaybackUrl(candidateUrl);
        try {
          if (DEBUG_AUDIO) {
            console.debug('[audio] trying saavn candidate', i, candidateUrl.slice(0, 180));
          }
          await probeAudioSource(probe, playbackUrl, 12000);
          const resolved: ResolvedStream = {
            url: playbackUrl,
            directUrl: candidateUrl,
            viaProxy: playbackUrl !== candidateUrl,
            durationSec: Number(song.durationSec || 0),
            base: saavnBase,
          };
          streamCacheRef.current.set(song.id, resolved);
          return resolved;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          // Fallback: try direct URL if proxy fails.
          if (playbackUrl !== candidateUrl) {
            try {
              await probeAudioSource(probe, candidateUrl, 12000);
              const resolved: ResolvedStream = {
                url: candidateUrl,
                directUrl: candidateUrl,
                viaProxy: false,
                durationSec: Number(song.durationSec || 0),
                base: saavnBase,
              };
              streamCacheRef.current.set(song.id, resolved);
              return resolved;
            } catch (directErr) {
              lastError = directErr instanceof Error ? directErr.message : String(directErr);
            }
          }
          if (lastError.includes('timeout')) {
            return {
              url: playbackUrl,
              directUrl: candidateUrl,
              viaProxy: playbackUrl !== candidateUrl,
              durationSec: Number(song.durationSec || 0),
              base: saavnBase,
            };
          }
          if (DEBUG_AUDIO) {
            console.warn('[audio] saavn candidate failed', i, lastError);
          }
        }
      }
    }

    throw new Error(`The element has no supported sources (${lastError}).`);
  }

  async function warmPlayableCache(seedSongs: Song[]): Promise<void> {
    for (const song of seedSongs) {
      if (streamCacheRef.current.has(song.id) || invalidTrackRef.current.has(song.id)) {
        continue;
      }
      try {
        await resolvePlayableStream(song);
      } catch {
        invalidTrackRef.current.add(song.id);
      }
    }
  }

  async function playNextAvailable(fromTrackId: string, maxAttempts: number): Promise<boolean> {
    if (!queue.length) {
      return false;
    }
    const startIdx = queue.findIndex((item) => item.id === fromTrackId);
    const limit = Math.min(maxAttempts, queue.length);

    for (let step = 1; step <= limit; step += 1) {
      const idx = (startIdx + step + queue.length) % queue.length;
      const candidate = queue[idx];
      if (!candidate || invalidTrackRef.current.has(candidate.id)) {
        continue;
      }
      try {
        const resolved = await resolvePlayableStream(candidate);
        await startPlayback(candidate, resolved);
        return true;
      } catch {
        invalidTrackRef.current.add(candidate.id);
      }
    }

    return false;
  }

  function toggleLiked(songId: string, songHint?: Song) {
    let willLike = false;
    setLikedTrackIds((prev) => {
      const next = new Set(prev);
      if (next.has(songId)) {
        next.delete(songId);
        willLike = false;
      } else {
        next.add(songId);
        willLike = true;
      }
      return next;
    });
    setLikedSongStore((prev) => {
      const exists = prev.some((song) => song.id === songId);
      const candidate = songHint || queue.find((song) => song.id === songId) || (currentTrack?.id === songId ? currentTrack : undefined);
      if (willLike && candidate && !exists) {
        return [candidate, ...prev];
      }
      if (!willLike) {
        return prev.filter((song) => song.id !== songId);
      }
      return prev;
    });
  }

  function toggleQueued(songId: string) {
    setQueuedTrackIds((prev) => {
      if (prev.includes(songId)) {
        return prev.filter((id) => id !== songId);
      }
      return [...prev, songId];
    });
  }

  function openPlaylist(playlistId: string) {
    setSelectedPlaylistId(playlistId);
    setLibraryTab('playlists');
    setView('playlist');
  }

  function createPlaylist() {
    const name = newPlaylistName.trim();
    if (!name) {
      setStatus('Enter a playlist name');
      return;
    }

    const playlist: Playlist = {
      id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      songs: [],
      createdAt: Date.now(),
    };
    setPlaylists((prev) => [playlist, ...prev]);
    setNewPlaylistName('');
    setStatus(`Playlist created: ${name}`);
    openPlaylist(playlist.id);
  }

  function addSongToPlaylist(playlistId: string, song: Song) {
    let added = false;
    setPlaylists((prev) =>
      prev.map((playlist) => {
        if (playlist.id !== playlistId) {
          return playlist;
        }
        if (playlist.songs.some((item) => item.id === song.id)) {
          return playlist;
        }
        added = true;
        return { ...playlist, songs: [...playlist.songs, song] };
      }),
    );
    setStatus(added ? `Added to playlist: ${song.title}` : `${song.title} is already in this playlist`);
  }

  function addSongToPlaylistFromAnywhere(song: Song) {
    if (!playlists.length) {
      setLibraryTab('playlists');
      setView('playlist');
      setStatus('Create a playlist first');
      return;
    }

    if (selectedPlaylistId && playlists.some((playlist) => playlist.id === selectedPlaylistId)) {
      addSongToPlaylist(selectedPlaylistId, song);
      return;
    }

    if (playlists.length === 1) {
      addSongToPlaylist(playlists[0].id, song);
      return;
    }

    if (typeof window === 'undefined') {
      addSongToPlaylist(playlists[0].id, song);
      return;
    }

    const promptText = `Add to which playlist?\n${playlists.map((p, i) => `${i + 1}. ${p.name}`).join('\n')}\n\nEnter number:`;
    const raw = window.prompt(promptText, '1');
    if (!raw) {
      return;
    }
    const index = Number(raw) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= playlists.length) {
      setStatus('Invalid playlist choice');
      return;
    }
    addSongToPlaylist(playlists[index].id, song);
  }

  function renameSelectedPlaylist() {
    if (!selectedPlaylist) {
      setStatus('Select a playlist first');
      return;
    }
    const name = playlistNameDraft.trim();
    if (!name) {
      setStatus('Playlist name cannot be empty');
      return;
    }
    setPlaylists((prev) => prev.map((playlist) => (
      playlist.id === selectedPlaylist.id ? { ...playlist, name } : playlist
    )));
    setStatus('Playlist name updated');
  }

  function deleteSelectedPlaylist() {
    if (!selectedPlaylist) {
      return;
    }
    if (typeof window !== 'undefined' && !window.confirm(`Delete playlist "${selectedPlaylist.name}"?`)) {
      return;
    }

    setPlaylists((prev) => prev.filter((playlist) => playlist.id !== selectedPlaylist.id));
    setSelectedPlaylistId((prev) => (prev === selectedPlaylist.id ? null : prev));
    setStatus(`Deleted playlist: ${selectedPlaylist.name}`);
  }

  function removeSongFromSelectedPlaylist(songId: string) {
    if (!selectedPlaylist) {
      return;
    }
    setPlaylists((prev) => prev.map((playlist) => (
      playlist.id === selectedPlaylist.id
        ? { ...playlist, songs: playlist.songs.filter((song) => song.id !== songId) }
        : playlist
    )));
    setStatus('Removed track from playlist');
  }

  function openPlaylistEditor(mode: 'create' | 'edit') {
    setPlaylistEditorMode(mode);

    if (mode === 'create') {
      setEditorPlaylistId(null);
      setEditorName('');
      setEditorDescription('');
      setEditorCover('');
      setView('playlist-editor');
      return;
    }

    const target = selectedPlaylist || playlists[0];
    if (!target) {
      setStatus('No playlist to edit. Create one first.');
      setPlaylistEditorMode('create');
      setEditorPlaylistId(null);
      setEditorName('');
      setEditorDescription('');
      setEditorCover('');
      setView('playlist-editor');
      return;
    }

    setEditorPlaylistId(target.id);
    setEditorName(target.name);
    setEditorDescription(target.description || '');
    setEditorCover(target.cover || '');
    setView('playlist-editor');
  }

  function loadEditorFromPlaylist(playlistId: string) {
    const playlist = playlists.find((item) => item.id === playlistId);
    if (!playlist) {
      return;
    }
    setEditorPlaylistId(playlist.id);
    setEditorName(playlist.name);
    setEditorDescription(playlist.description || '');
    setEditorCover(playlist.cover || '');
  }

  function onEditorCoverUpload(file: File | null) {
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      setStatus('Please choose an image file');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        setStatus('Failed to read image');
        return;
      }
      setEditorCover(result);
    };
    reader.onerror = () => setStatus('Failed to read image');
    reader.readAsDataURL(file);
  }

  function savePlaylistFromEditor() {
    const name = editorName.trim();
    if (!name) {
      setStatus('Playlist name cannot be empty');
      return;
    }

    if (playlistEditorMode === 'create') {
      const playlist: Playlist = {
        id: `pl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        description: editorDescription.trim(),
        cover: editorCover || undefined,
        songs: [],
        createdAt: Date.now(),
      };
      setPlaylists((prev) => [playlist, ...prev]);
      setSelectedPlaylistId(playlist.id);
      setLibraryTab('playlists');
      setView('playlist');
      setStatus(`Playlist created: ${name}`);
      return;
    }

    if (!editorPlaylistId) {
      setStatus('Select a playlist to edit');
      return;
    }

    setPlaylists((prev) => prev.map((playlist) => (
      playlist.id === editorPlaylistId
        ? {
            ...playlist,
            name,
            description: editorDescription.trim(),
            cover: editorCover || undefined,
          }
        : playlist
    )));
    setSelectedPlaylistId(editorPlaylistId);
    setLibraryTab('playlists');
    setView('playlist');
    setStatus('Playlist updated');
  }

  function onPlaylistCoverUpload(file: File | null) {
    if (!selectedPlaylist || !file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      setStatus('Please choose an image file');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        setStatus('Failed to read image');
        return;
      }
      setPlaylists((prev) => prev.map((playlist) => (
        playlist.id === selectedPlaylist.id ? { ...playlist, cover: result } : playlist
      )));
      setStatus('Playlist cover updated');
    };
    reader.onerror = () => setStatus('Failed to read image');
    reader.readAsDataURL(file);
  }

  async function handleDownload(song: Song) {
    try {
      const resolved = await resolvePlayableStream(song);
      if (typeof window !== 'undefined') {
        window.open(resolved.directUrl || resolved.url, '_blank', 'noopener,noreferrer');
      }
      setStatus(`Opened source for ${song.title}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Download source unavailable';
      setStatus(msg);
    }
  }

  async function handleAuthSubmit() {
    setAuthSubmitting(true);
    setAuthError('');
    try {
      if (USE_TEST_AUTH) {
        const emailValue = email.trim().toLowerCase();
        if (!emailValue || !password) {
          throw new Error('Email and password required');
        }
        const passwordHash = await hashPassword(password);
        if (!supabase) {
          throw new Error('Supabase is not configured');
        }

        if (authMode === 'signup') {
          const { data: existing, error: existingError } = await supabase
            .from('test_users')
            .select('id,email')
            .eq('email', emailValue)
            .maybeSingle();
          if (existingError) {
            throw existingError;
          }
          if (existing) {
            throw new Error('Email already exists');
          }

          const { data: created, error: insertError } = await supabase
            .from('test_users')
            .insert({ email: emailValue, password_hash: passwordHash })
            .select('id,email')
            .single();
          if (insertError) {
            throw insertError;
          }
          const nextSession: AuthSession = { user: { id: created.id, email: created.email } };
          setSession(nextSession);
          writeTestSession(nextSession);
          setCloudSyncStatus('Test account created');
          return;
        }

        const { data: userRow, error: userError } = await supabase
          .from('test_users')
          .select('id,email,password_hash')
          .eq('email', emailValue)
          .maybeSingle();
        if (userError) {
          throw userError;
        }
        if (!userRow || userRow.password_hash !== passwordHash) {
          throw new Error('Invalid email or password');
        }
        const nextSession: AuthSession = { user: { id: userRow.id, email: userRow.email } };
        setSession(nextSession);
        writeTestSession(nextSession);
        setCloudSyncStatus('Signed in (test mode)');
        return;
      }

      if (!supabase) {
        setAuthError('Supabase is not configured');
        return;
      }
      if (authMode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) {
          throw signUpError;
        }
        setCloudSyncStatus('Sign-up successful. Check your email if confirmation is enabled.');
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) {
          throw signInError;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      setAuthError(msg);
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleSignOut() {
    if (USE_TEST_AUTH) {
      writeTestSession(null);
      setSession(null);
      setCloudSyncStatus('Signed out');
      return;
    }
    if (!supabase) {
      return;
    }
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setCloudSyncStatus(`Sign out failed: ${signOutError.message}`);
      return;
    }
    setCloudSyncStatus('Signed out');
    setSession(null);
  }

  const progress = duration ? Math.min(100, (currentTime / duration) * 100) : 0;
  const topPickDisplay: Song[] = loading
    ? Array.from({ length: 6 }, (_, idx) => ({
        id: `skeleton-${idx}`,
        title: 'Loading track...',
        artist: 'Please wait',
        cover: '',
      }))
    : topPicks;

  if (!isSupabaseConfigured) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020304] p-6 text-[#f4f4f5]">
        <div className="glass w-full max-w-[560px] rounded-2xl p-6">
          <h1 className="text-xl font-semibold">Supabase Setup Required</h1>
          <p className="mt-2 text-sm text-[#9ea2a8]">
            Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (or the `NEXT_PUBLIC_` equivalents) in your `.env`.
          </p>
          <p className="mt-2 text-xs text-[#7d8087]">
            Then run the SQL in `supabase/schema.sql` inside your Supabase SQL editor.
          </p>
        </div>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020304] text-[#f4f4f5]">
        <p className="text-sm text-[#a6a9b0]">Connecting to Supabase...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#020304] p-5 text-[#f4f4f5] sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(255,255,255,0.10)_0%,rgba(255,255,255,0)_40%)]" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_92%_90%,rgba(255,145,84,0.14)_0%,rgba(255,145,84,0)_45%)]" />

        <div className="relative grid w-full max-w-[980px] overflow-hidden rounded-[26px] border border-white/10 bg-[#0b0f16]/85 shadow-[0_24px_80px_rgba(0,0,0,0.52)] md:grid-cols-[1.05fr_0.95fr]">
          <section className="hidden min-h-[560px] flex-col justify-between border-r border-white/8 bg-[linear-gradient(150deg,#111a29_0%,#0b1019_45%,#120d0b_100%)] p-9 md:flex">
            <div>
              <p className="text-[10px] tracking-[0.24em] text-white/55">RYTHM CLOUD</p>
              <h1 className="mt-4 text-[42px] font-semibold leading-[1.05] text-white">Your music, synced everywhere.</h1>
              <p className="mt-4 max-w-[420px] text-sm text-[#adb3bd]">
                Secure sign in with Supabase keeps playlists, likes, and playback progress linked to your account.
              </p>
            </div>
            <div className="space-y-2 text-xs text-[#9da3ad]">
              <p>1. Authenticated access only</p>
              <p>2. Per-user encrypted session</p>
              <p>3. Automatic cloud backup of your library</p>
            </div>
          </section>

          <section className="p-6 sm:p-8">
            <div className="flex items-center justify-between">
              <h2 className="text-[30px] font-semibold text-white sm:text-[34px]">
              {authMode === 'signup' ? 'Create your account' : 'Welcome back'}
              </h2>
            </div>
            <p className="mt-2 text-sm text-[#9ea2a8]">
              {authMode === 'signup'
                ? 'Create an account in seconds.'
                : 'Sign in to continue your session.'}
            </p>

            <div className="mt-6 flex rounded-full bg-white/6 p-1 text-xs">
              <button
                type="button"
                onClick={() => setAuthMode('signin')}
                className={`flex-1 rounded-full px-3 py-2 ${authMode === 'signin' ? 'bg-white/14 text-white' : 'text-[#c9ccd2]'}`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setAuthMode('signup')}
                className={`flex-1 rounded-full px-3 py-2 ${authMode === 'signup' ? 'bg-white/14 text-white' : 'text-[#c9ccd2]'}`}
              >
                Sign Up
              </button>
            </div>

            <div className="mt-5 space-y-2.5">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                className="w-full rounded-xl border border-white/8 bg-white/8 px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#8c9097] focus:border-white/20"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full rounded-xl border border-white/8 bg-white/8 px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#8c9097] focus:border-white/20"
              />
            </div>

            {authError ? <p className="mt-3 text-xs text-[#ff9d9d]">{authError}</p> : null}

            <button
              type="button"
              onClick={() => void handleAuthSubmit()}
              disabled={authSubmitting || !email.trim() || !password}
              className="mt-5 w-full rounded-xl bg-white/14 px-4 py-2.5 text-sm text-white hover:bg-white/20 disabled:opacity-50"
            >
              {authSubmitting ? 'Please wait...' : authMode === 'signup' ? 'Create Account' : 'Sign In'}
            </button>

            <p className="mt-3 text-[11px] text-[#8f939a]">
              {cloudSyncStatus || 'Your playlists and progress will sync after sign in.'}
            </p>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#020304] text-[#f4f4f5]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.09)_0%,rgba(255,255,255,0)_45%)]" />
      <audio ref={audioRef} preload="none" crossOrigin="anonymous" />
      {isExpandedPlayer ? (
        <section className="fixed inset-0 z-[90] overflow-hidden bg-[radial-gradient(circle_at_50%_0%,#1a2030_0%,#0a0f1e_42%,#080b14_100%)]">
          <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-5 py-4 text-[10px] tracking-[0.28em] text-white/70">
            <button className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10" onClick={() => setIsExpandedPlayer(false)} aria-label="Close expanded player">
              <ChevronDown size={15} />
            </button>
            <p>NOW PLAYING</p>
            <button className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/10" onClick={() => setIsExpandedPlayer(false)} aria-label="Minimize">
              <Minimize2 size={13} />
            </button>
          </div>

          <div className="absolute inset-0 z-0 bg-gradient-to-t from-[#0e0a09]/80 via-[#1a120e]/40 to-transparent" />
          <div className="absolute inset-0 z-0 px-2">
            <div className="flex h-full items-end gap-[3px]">
              {vizBars.map((height, idx) => (
                <span
                  key={`bar-${idx}`}
                  className="flex-1 rounded-t-[2px] bg-[#4d3125]/85"
                  style={{ height: `${height}%` }}
                />
              ))}
            </div>
          </div>

          <div className="relative z-10 mx-auto flex h-full w-full max-w-[1220px] flex-col px-6 pb-9 pt-20">
            <div className="grid flex-1 items-center gap-10 md:grid-cols-[420px_1fr]">
              <div className="mx-auto w-[min(380px,78vw)] rounded-[16px] bg-black/30 p-3 shadow-[0_24px_70px_rgba(0,0,0,0.45)]">
                <SmartThumbnail
                  src={currentTrack?.cover || ''}
                  fallbackSrc={currentTrack?.coverFallback || 'https://picsum.photos/seed/player-full/600/600'}
                  alt={currentTrack?.title || 'Now playing'}
                  className="aspect-square w-full rounded-[12px] object-cover object-center"
                />
              </div>

              <div className="space-y-5">
                <p className="text-[13px] text-white/40">Instrumental / No synced lyrics</p>
              </div>
            </div>

            <div className="relative z-20 mx-auto w-full max-w-[760px] text-white/85">
              <div className="mb-1.5 flex items-end justify-between">
                <div className="min-w-0">
                  <p className="truncate text-[21px] font-semibold text-white">{currentTrack?.title || 'Choose a track'}</p>
                  <p className="truncate text-[12px] text-white/60">{currentTrack?.artist || 'No artist selected'}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="player-icon-btn text-white/70"
                    onClick={() => currentTrack && addSongToPlaylistFromAnywhere(currentTrack)}
                    aria-label="Add current track to playlist"
                  >
                    <FolderPlus size={15} />
                  </button>
                  <button
                    className={`player-icon-btn ${currentTrack && likedTrackIds.has(currentTrack.id) ? 'text-white' : 'text-white/70'}`}
                    onClick={() => currentTrack && toggleLiked(currentTrack.id, currentTrack)}
                    aria-label="Like current track"
                  >
                    <Heart size={15} fill={currentTrack && likedTrackIds.has(currentTrack.id) ? 'currentColor' : 'none'} />
                  </button>
                </div>
              </div>

              <div className="mb-3 flex items-center gap-2 text-[11px] text-white/70">
                <span>{formatDuration(currentTime)}</span>
                <button
                  type="button"
                  className="relative h-[3px] flex-1 rounded-full bg-white/35"
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                    const ratio = (e.clientX - rect.left) / rect.width;
                    seekTo(ratio);
                  }}
                  aria-label="Seek"
                >
                  <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${progress}%` }} />
                </button>
                <span>{formatDuration(duration || currentTrack?.durationSec || 0)}</span>
              </div>

              <div className="mx-auto flex w-full max-w-[430px] items-center justify-between">
                <button
                  className={`player-icon-btn ${isShuffle ? 'text-white' : 'text-white/65'}`}
                  onClick={() => setIsShuffle((prev) => !prev)}
                  aria-label="Shuffle"
                  title="Shuffle"
                >
                  <Shuffle size={15} />
                </button>
                <button className="player-icon-btn text-white/85" onClick={playPrev} aria-label="Previous" disabled={!currentTrack}>
                  <SkipBack size={16} />
                </button>
                <button
                  className="player-main-btn flex h-14 w-14 items-center justify-center rounded-full bg-white text-black disabled:opacity-50"
                  onClick={() => void togglePlay()}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  disabled={!currentTrack}
                >
                  {isPlaying ? <Pause size={22} /> : <Play size={22} className="translate-x-[1px]" fill="black" />}
                </button>
                <button className="player-icon-btn text-white/85" onClick={playNext} aria-label="Next" disabled={!currentTrack}>
                  <SkipForward size={16} />
                </button>
                <button className="player-icon-btn text-white/70" onClick={() => setIsExpandedPlayer(false)} aria-label="Exit full player">
                  <Minimize2 size={15} />
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <div className="flex min-h-screen pb-32">
        <aside className="hidden w-[240px] shrink-0 px-3 py-4 lg:block xl:w-[250px]">
          <div className="sticky top-0 flex h-[calc(100vh-112px)] flex-col gap-3">
            <div className="glass p-3.5">
              <div className="mb-3 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1ed760] text-black">
                  <Mic2 size={14} />
                </div>
                <span className="text-xs font-semibold">Melodify</span>
              </div>

              <nav className="space-y-1 text-[11px] text-[#d6d6d8]">
                <SidebarItem icon={<Home size={12} />} label="Home" active={view === 'home'} onClick={() => setView('home')} />
                <SidebarItem icon={<Search size={12} />} label="Search" active={view === 'search'} onClick={() => setView('search')} />
              </nav>

              <div className="my-3 h-px bg-white/10" />

              <nav className="space-y-1 text-[11px] text-[#d6d6d8]">
                <SidebarItem icon={<UserRound size={12} />} label="Listen Along" />
              </nav>
            </div>

            <div className="glass flex min-h-0 flex-1 flex-col p-3">
              <div className="mb-2 flex items-center justify-between text-[11px]">
                <span className="text-[#d7d7d9]">Your Library</span>
                <span className="text-[#646468]">{libraryTab === 'liked' ? likedSongs.length : playlists.length}</span>
              </div>

              <div className="mb-3 flex rounded-full bg-white/5 p-0.5 text-[10px]">
                <button
                  type="button"
                  onClick={() => {
                    setLibraryTab('liked');
                    setView('liked');
                  }}
                  className={`rounded-full px-3 py-1 ${libraryTab === 'liked' ? 'bg-white/10 text-white' : 'text-[#d8d8da]'}`}
                >
                  Liked
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLibraryTab('playlists');
                    setView('playlist');
                  }}
                  className={`rounded-full px-3 py-1 ${libraryTab === 'playlists' ? 'bg-white/10 text-white' : 'text-[#d8d8da]'}`}
                >
                  Playlists
                </button>
              </div>

              <div className="space-y-2 overflow-y-auto pr-1">
                {libraryTab === 'liked' ? (
                  <button
                    type="button"
                    onClick={() => setView('liked')}
                    className={`flex w-full gap-2 rounded-lg p-1.5 text-left hover:bg-white/5 ${view === 'liked' ? 'bg-white/10' : ''}`}
                  >
                    <img src={LIKED_LIBRARY_COVER} alt="Liked Songs" className="h-9 w-9 rounded object-cover" />
                    <div className="min-w-0">
                      <p className="truncate text-[10.5px] text-[#eeeeef]">Liked Songs</p>
                      <p className="truncate text-[9.5px] text-[#7b7b7f]">{likedSongs.length} saved tracks</p>
                    </div>
                  </button>
                ) : (
                  <>
                    {playlists.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => setView('playlist')}
                        className="w-full rounded-lg p-1.5 text-left hover:bg-white/5"
                      >
                        <p className="px-1 py-2 text-[10px] text-[#7b7b7f]">No playlists yet. Open Playlists to create one.</p>
                      </button>
                    ) : (
                      playlists.map((playlist) => (
                        <button
                          key={playlist.id}
                          type="button"
                          onClick={() => openPlaylist(playlist.id)}
                          className={`flex w-full gap-2 rounded-lg p-1.5 text-left hover:bg-white/5 ${selectedPlaylistId === playlist.id && view === 'playlist' ? 'bg-white/10' : ''}`}
                        >
                          <img src={playlist.cover || playlist.songs[0]?.cover || PLAYLIST_LIBRARY_COVER} alt={playlist.name} className="h-9 w-9 rounded object-cover" />
                          <div className="min-w-0">
                            <p className="truncate text-[10.5px] text-[#eeeeef]">{playlist.name}</p>
                            <p className="truncate text-[9.5px] text-[#7b7b7f]">{playlist.songs.length} tracks</p>
                          </div>
                        </button>
                      ))
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-hidden px-4 pt-5 lg:px-4 lg:pr-6">
          <div className="mx-auto mb-3 flex w-full max-w-[1180px] items-center justify-end gap-2">
            {cloudSyncStatus ? <span className="text-[11px] text-[#8f939a]">{cloudSyncStatus}</span> : null}
            {isHydratingFromCloud ? <span className="text-[11px] text-[#8f939a]">Syncing...</span> : null}
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="rounded-full bg-white/10 px-3 py-1.5 text-[11px] text-white hover:bg-white/15"
            >
              Sign Out
            </button>
          </div>
          {view === 'home' ? (
            <div className="mx-auto max-w-[1130px] space-y-5">
              <section>
                <h1 className="mb-3 text-[44px] font-semibold tracking-[-0.02em] text-white sm:text-[40px]">Good evening</h1>

                <div className="grid gap-2.5 md:grid-cols-3">
                  {topPickDisplay.map((song) => (
                    <div
                      key={song.id}
                      className={`group flex h-[48px] items-center overflow-hidden rounded-lg bg-white/[0.08] px-2 text-left hover:bg-white/[0.11] ${
                        !song.id.startsWith('skeleton-') && currentTrack?.id === song.id ? 'ring-1 ring-[#1ed760]' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => !song.id.startsWith('skeleton-') && void selectTrack(song)}
                        className="flex min-w-0 flex-1 items-center text-left"
                      >
                        {song.id.startsWith('skeleton-') ? (
                          <div className="h-[38px] w-[38px] animate-pulse rounded bg-white/15" />
                        ) : (
                          <SmartThumbnail
                            src={song.cover}
                            fallbackSrc={song.coverFallback}
                            alt={song.title}
                            className="h-[38px] w-[38px] rounded object-cover object-center"
                          />
                        )}
                        <div className="ml-2 min-w-0">
                          <p className="truncate text-[11px] font-semibold text-[#f5f5f5]">{song.title}</p>
                          <p className="truncate text-[10px] text-[#a8a8ab]">{song.artist}</p>
                        </div>
                      </button>
                      {!song.id.startsWith('skeleton-') ? (
                        <button
                          type="button"
                          onClick={() => addSongToPlaylistFromAnywhere(song)}
                          className="rounded-full p-1.5 text-[#a4a8af] hover:bg-white/[0.08]"
                          aria-label="Add to playlist"
                        >
                          <FolderPlus size={13} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="mt-3.5 flex flex-wrap gap-2">
                  {chips.map((chip) => (
                    <button key={chip} className="rounded-full bg-white/[0.08] px-4 py-2 text-[11px] text-[#d6d6d8] hover:bg-white/[0.12]">
                      {chip}
                    </button>
                  ))}
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-end justify-between">
                  <div>
                    <h2 className="text-[34px] font-semibold tracking-[-0.01em] text-white">Trending Now</h2>
                    <p className="text-xs text-[#66666b]">Top tracks across India</p>
                  </div>
                  <button onClick={() => void loadMusicHome()} className="text-[11px] text-[#9ea0a6] hover:text-white">Refresh</button>
                </div>

                <div className="glass overflow-hidden px-2 py-1">
                  {trending.length === 0 ? (
                    <div className="px-3 py-6 text-sm text-[#8b8e95]">Trending is temporarily unavailable. Press refresh.</div>
                  ) : (
                    trending.map((song, idx) => (
                      <div
                        key={song.id + idx}
                        role="button"
                        tabIndex={0}
                        onClick={() => void selectTrack(song)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            void selectTrack(song);
                          }
                        }}
                        className={`grid w-full grid-cols-[24px_1fr_auto_auto_auto_auto] items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.04] ${
                          currentTrack?.id === song.id ? 'bg-white/[0.06]' : ''
                        }`}
                      >
                        <span className="text-[11px] text-[#8d8d91]">{idx + 1}</span>
                        <div className="flex min-w-0 items-center gap-2.5">
                          <SmartThumbnail
                            src={song.cover}
                            fallbackSrc={song.coverFallback}
                            alt={song.title}
                            className="h-8 w-8 rounded object-cover object-center"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-[11.5px] text-[#ededee]">{song.title}</p>
                            <p className="truncate text-[10.5px] text-[#7d7d81]">{song.artist}</p>
                          </div>
                        </div>
                        <p className="hidden w-[170px] truncate text-right text-[13px] text-[#8f9299] lg:block">{song.trendBucket || song.album || song.artist}</p>
                        <p className="w-[72px] text-right text-[13px] text-[#a0a4ab]">{song.streams || '--'}</p>
                        <div className="flex w-[132px] items-center justify-end gap-1.5 text-[#a4a8af]">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDownload(song);
                            }}
                            className="rounded-full p-1.5 hover:bg-white/[0.08]"
                            aria-label="Open source"
                          >
                            <Download size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleLiked(song.id, song);
                            }}
                            className={`rounded-full p-1.5 hover:bg-white/[0.08] ${likedTrackIds.has(song.id) ? 'text-[#f2f4f8]' : ''}`}
                            aria-label="Like"
                          >
                            <Heart size={14} fill={likedTrackIds.has(song.id) ? 'currentColor' : 'none'} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleQueued(song.id);
                            }}
                            className={`rounded-full p-1.5 hover:bg-white/[0.08] ${queuedTrackIds.includes(song.id) ? 'text-[#1ed760]' : ''}`}
                            aria-label="Queue"
                          >
                            <ListPlus size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              addSongToPlaylistFromAnywhere(song);
                            }}
                            className="rounded-full p-1.5 hover:bg-white/[0.08]"
                            aria-label="Add to playlist"
                          >
                            <FolderPlus size={14} />
                          </button>
                        </div>
                        <p className="w-[52px] text-right text-[13px] text-[#a0a4ab]">{formatDuration(song.durationSec)}</p>
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section>
                <div className="mb-2">
                  <h2 className="text-[39px] font-semibold tracking-[-0.01em] text-white sm:text-[34px]">Arijit Singh Essentials</h2>
                <p className="text-xs text-[#68686d]">Live results from Saavn</p>
                </div>

                <div className="hide-scrollbar flex gap-2.5 overflow-x-auto pb-1">
                  {essentials.map((song) => (
                    <article
                      key={song.id}
                      onClick={() => void selectTrack(song)}
                      className={`group w-[138px] shrink-0 cursor-pointer rounded-xl bg-white/[0.06] p-2.5 backdrop-blur-md transition hover:bg-white/[0.1] ${
                        currentTrack?.id === song.id ? 'ring-1 ring-[#1ed760]' : ''
                      }`}
                    >
                      <SmartThumbnail
                        src={song.cover}
                        fallbackSrc={song.coverFallback}
                        alt={song.title}
                        className="h-[122px] w-full rounded-lg object-cover object-center"
                      />
                      <h3 className="mt-2 line-clamp-2 text-[11px] text-[#efeff0]">{song.title}</h3>
                      <p className="mt-1 line-clamp-2 text-[10px] text-[#7f7f83]">{song.artist}</p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          addSongToPlaylistFromAnywhere(song);
                        }}
                        className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[10px] text-white hover:bg-white/15"
                      >
                        <FolderPlus size={11} />
                        Add
                      </button>
                    </article>
                  ))}
                </div>
              </section>

              <section className="pb-16">
                <h2 className="text-[38px] font-semibold tracking-[-0.01em] text-white sm:text-[33px]">New Releases</h2>
                <p className="text-xs text-[#67676b]">Fresh from the source</p>
                <div className="hide-scrollbar mt-3 flex gap-2.5 overflow-x-auto pb-2">
                  {newReleases.map((release) => (
                    <article
                      key={release.id}
                      onClick={() => void selectTrack(release)}
                      className={`group w-[138px] shrink-0 cursor-pointer rounded-xl bg-white/[0.06] p-2.5 transition hover:bg-white/[0.1] ${
                        currentTrack?.id === release.id ? 'ring-1 ring-[#1ed760]' : ''
                      }`}
                    >
                      <SmartThumbnail
                        src={release.cover}
                        fallbackSrc={release.coverFallback}
                        alt={release.title}
                        className="h-[122px] w-full rounded-lg object-cover object-center"
                      />
                      <h3 className="mt-2 line-clamp-2 text-[11px] text-[#efeff0]">{release.title}</h3>
                      <p className="mt-1 line-clamp-2 text-[10px] text-[#7f7f83]">{release.artist}</p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          addSongToPlaylistFromAnywhere(release);
                        }}
                        className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[10px] text-white hover:bg-white/15"
                      >
                        <FolderPlus size={11} />
                        Add
                      </button>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          ) : view === 'liked' ? (
            <div className="mx-auto max-w-[1130px] space-y-4 pb-16">
              <section>
                <h1 className="text-[42px] font-semibold tracking-[-0.02em] text-white sm:text-[38px]">Liked Songs</h1>
                <p className="text-xs text-[#7b7d84]">Your saved tracks ({likedSongs.length})</p>
              </section>

              <section className="glass overflow-hidden px-2 py-1">
                {likedSongs.length === 0 ? (
                  <div className="px-4 py-8 text-sm text-[#8b8e95]">
                    No liked songs yet. Tap the heart icon on any track to save it here.
                  </div>
                ) : (
                  likedSongs.map((song, idx) => (
                    <div
                      key={`liked-${song.id}-${idx}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => void selectTrack(song)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void selectTrack(song);
                        }
                      }}
                      className={`grid w-full grid-cols-[24px_1fr_auto_auto_auto_auto] items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.04] ${
                        currentTrack?.id === song.id ? 'bg-white/[0.06]' : ''
                      }`}
                    >
                      <span className="text-[11px] text-[#8d8d91]">{idx + 1}</span>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <SmartThumbnail
                          src={song.cover}
                          fallbackSrc={song.coverFallback}
                          alt={song.title}
                          className="h-8 w-8 rounded object-cover object-center"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[11.5px] text-[#ededee]">{song.title}</p>
                          <p className="truncate text-[10.5px] text-[#7d7d81]">{song.artist}</p>
                        </div>
                      </div>
                      <p className="hidden w-[170px] truncate text-right text-[13px] text-[#8f9299] lg:block">{song.album || song.artist}</p>
                      <p className="w-[72px] text-right text-[13px] text-[#a0a4ab]">{song.streams || '--'}</p>
                      <div className="flex w-[132px] items-center justify-end gap-1.5 text-[#a4a8af]">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDownload(song);
                          }}
                          className="rounded-full p-1.5 hover:bg-white/[0.08]"
                          aria-label="Open source"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLiked(song.id, song);
                          }}
                          className={`rounded-full p-1.5 hover:bg-white/[0.08] ${likedTrackIds.has(song.id) ? 'text-[#f2f4f8]' : ''}`}
                          aria-label="Like"
                        >
                          <Heart size={14} fill={likedTrackIds.has(song.id) ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleQueued(song.id);
                          }}
                          className={`rounded-full p-1.5 hover:bg-white/[0.08] ${queuedTrackIds.includes(song.id) ? 'text-[#1ed760]' : ''}`}
                          aria-label="Queue"
                        >
                          <ListPlus size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            addSongToPlaylistFromAnywhere(song);
                          }}
                          className="rounded-full p-1.5 hover:bg-white/[0.08]"
                          aria-label="Add to playlist"
                        >
                          <FolderPlus size={14} />
                        </button>
                      </div>
                      <p className="w-[52px] text-right text-[13px] text-[#a0a4ab]">{formatDuration(song.durationSec)}</p>
                    </div>
                  ))
                )}
              </section>
            </div>
          ) : view === 'playlist' ? (
            <div className="mx-auto max-w-[1130px] space-y-4 pb-16">
              <section className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => playlistCoverInputRef.current?.click()}
                    className="group relative h-20 w-20 overflow-hidden rounded-xl bg-white/8"
                    title="Upload playlist cover"
                    disabled={!selectedPlaylist}
                  >
                    <img
                      src={selectedPlaylist?.cover || selectedPlaylist?.songs[0]?.cover || PLAYLIST_LIBRARY_COVER}
                      alt={selectedPlaylist?.name || 'Playlist cover'}
                      className="h-full w-full object-cover object-center"
                    />
                    <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-white/90 group-hover:flex">
                      <ImagePlus size={16} />
                    </span>
                  </button>
                  <input
                    ref={playlistCoverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => onPlaylistCoverUpload(e.target.files?.[0] || null)}
                  />
                  <h1 className="text-[42px] font-semibold tracking-[-0.02em] text-white sm:text-[38px]">
                    {selectedPlaylist?.name || 'Playlist'}
                  </h1>
                  <div>
                    <p className="text-xs text-[#7b7d84]">{selectedPlaylist ? `${selectedPlaylist.songs.length} tracks` : 'Choose a playlist from the sidebar'}</p>
                    {selectedPlaylist?.description ? (
                      <p className="mt-1 max-w-[540px] text-[11px] text-[#9ba0a8]">{selectedPlaylist.description}</p>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openPlaylistEditor(selectedPlaylist ? 'edit' : 'create')}
                    className="rounded-full bg-white/12 px-4 py-2 text-xs text-white hover:bg-white/18"
                  >
                    {selectedPlaylist ? 'Edit / Create Playlist' : 'Create / Edit Playlist'}
                  </button>
                  <input
                    value={playlistNameDraft}
                    onChange={(e) => setPlaylistNameDraft(e.target.value)}
                    placeholder="Rename playlist"
                    className="min-w-[180px] rounded-full bg-white/8 px-4 py-2 text-xs text-white outline-none placeholder:text-[#8c9097]"
                    disabled={!selectedPlaylist}
                  />
                  <button
                    type="button"
                    onClick={renameSelectedPlaylist}
                    className="rounded-full bg-white/10 px-4 py-2 text-xs text-white hover:bg-white/15 disabled:opacity-50"
                    disabled={!selectedPlaylist}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Pencil size={12} />
                      Save Name
                    </span>
                  </button>
                  <input
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        createPlaylist();
                      }
                    }}
                    placeholder="New playlist name"
                    className="min-w-[180px] rounded-full bg-white/8 px-4 py-2 text-xs text-white outline-none placeholder:text-[#8c9097]"
                  />
                  <button
                    type="button"
                    onClick={createPlaylist}
                    className="rounded-full bg-white/12 px-4 py-2 text-xs text-white hover:bg-white/18"
                  >
                    Create Playlist
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedPlaylist}
                    className="rounded-full bg-red-500/20 px-4 py-2 text-xs text-red-100 hover:bg-red-500/30 disabled:opacity-50"
                    disabled={!selectedPlaylist}
                  >
                    <span className="inline-flex items-center gap-1">
                      <Trash2 size={12} />
                      Delete
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedPlaylistId || !currentTrack) {
                        setStatus('Play a track first, then add it to a playlist');
                        return;
                      }
                      addSongToPlaylist(selectedPlaylistId, currentTrack);
                    }}
                    className="rounded-full bg-white/10 px-4 py-2 text-xs text-white hover:bg-white/15"
                  >
                    Add Current Track
                  </button>
                </div>
              </section>

              <section className="glass overflow-hidden px-2 py-1">
                {!selectedPlaylist ? (
                  <div className="px-4 py-8 text-sm text-[#8b8e95]">No playlist selected.</div>
                ) : selectedPlaylist.songs.length === 0 ? (
                  <div className="px-4 py-8 text-sm text-[#8b8e95]">
                    This playlist is empty. Play a song and press "Add Current Track".
                  </div>
                ) : (
                  selectedPlaylist.songs.map((song, idx) => (
                    <div
                      key={`pl-${selectedPlaylist.id}-${song.id}-${idx}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => void selectTrack(song)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void selectTrack(song);
                        }
                      }}
                      className={`grid w-full grid-cols-[24px_1fr_auto_auto_auto_auto] items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.04] ${
                        currentTrack?.id === song.id ? 'bg-white/[0.06]' : ''
                      }`}
                    >
                      <span className="text-[11px] text-[#8d8d91]">{idx + 1}</span>
                      <div className="flex min-w-0 items-center gap-2.5">
                        <SmartThumbnail
                          src={song.cover}
                          fallbackSrc={song.coverFallback}
                          alt={song.title}
                          className="h-8 w-8 rounded object-cover object-center"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-[11.5px] text-[#ededee]">{song.title}</p>
                          <p className="truncate text-[10.5px] text-[#7d7d81]">{song.artist}</p>
                        </div>
                      </div>
                      <p className="hidden w-[170px] truncate text-right text-[13px] text-[#8f9299] lg:block">{song.album || song.artist}</p>
                      <p className="w-[72px] text-right text-[13px] text-[#a0a4ab]">{song.streams || '--'}</p>
                      <div className="flex w-[132px] items-center justify-end gap-1.5 text-[#a4a8af]">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDownload(song);
                          }}
                          className="rounded-full p-1.5 hover:bg-white/[0.08]"
                          aria-label="Open source"
                        >
                          <Download size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLiked(song.id, song);
                          }}
                          className={`rounded-full p-1.5 hover:bg-white/[0.08] ${likedTrackIds.has(song.id) ? 'text-[#f2f4f8]' : ''}`}
                          aria-label="Like"
                        >
                          <Heart size={14} fill={likedTrackIds.has(song.id) ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleQueued(song.id);
                          }}
                          className={`rounded-full p-1.5 hover:bg-white/[0.08] ${queuedTrackIds.includes(song.id) ? 'text-[#1ed760]' : ''}`}
                          aria-label="Queue"
                        >
                          <ListPlus size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            addSongToPlaylistFromAnywhere(song);
                          }}
                          className="rounded-full p-1.5 hover:bg-white/[0.08]"
                          aria-label="Add to playlist"
                        >
                          <FolderPlus size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeSongFromSelectedPlaylist(song.id);
                          }}
                          className="rounded-full p-1.5 hover:bg-white/[0.08]"
                          aria-label="Remove from playlist"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      <p className="w-[52px] text-right text-[13px] text-[#a0a4ab]">{formatDuration(song.durationSec)}</p>
                    </div>
                  ))
                )}
              </section>
            </div>
          ) : view === 'playlist-editor' ? (
            <div className="mx-auto max-w-[980px] space-y-4 pb-16">
              <section>
                <h1 className="text-[40px] font-semibold tracking-[-0.02em] text-white sm:text-[36px]">Playlist Editor</h1>
                <p className="text-xs text-[#7b7d84]">Create or edit playlists with cover image and details.</p>
              </section>

              <section className="glass space-y-4 rounded-2xl p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPlaylistEditorMode('create');
                      setEditorPlaylistId(null);
                      setEditorName('');
                      setEditorDescription('');
                      setEditorCover('');
                    }}
                    className={`rounded-full px-4 py-2 text-xs ${playlistEditorMode === 'create' ? 'bg-white/14 text-white' : 'bg-white/7 text-[#cfd3d9]'}`}
                  >
                    Create New
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlaylistEditorMode('edit');
                      if (selectedPlaylist) {
                        loadEditorFromPlaylist(selectedPlaylist.id);
                      } else if (playlists[0]) {
                        loadEditorFromPlaylist(playlists[0].id);
                      }
                    }}
                    className={`rounded-full px-4 py-2 text-xs ${playlistEditorMode === 'edit' ? 'bg-white/14 text-white' : 'bg-white/7 text-[#cfd3d9]'}`}
                  >
                    Edit Existing
                  </button>
                </div>

                {playlistEditorMode === 'edit' ? (
                  <div className="space-y-1">
                    <label className="text-[11px] text-[#9ca0a8]">Select Playlist</label>
                    <select
                      value={editorPlaylistId || ''}
                      onChange={(e) => loadEditorFromPlaylist(e.target.value)}
                      className="w-full rounded-xl bg-white/8 px-3 py-2 text-sm text-white outline-none"
                    >
                      {playlists.length === 0 ? <option value="">No playlists</option> : null}
                      {playlists.map((playlist) => (
                        <option key={playlist.id} value={playlist.id}>
                          {playlist.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => editorCoverInputRef.current?.click()}
                      className="group relative h-[180px] w-[180px] overflow-hidden rounded-xl bg-white/8"
                    >
                      <img
                        src={editorCover || PLAYLIST_LIBRARY_COVER}
                        alt="Playlist cover"
                        className="h-full w-full object-cover object-center"
                      />
                      <span className="absolute inset-0 hidden items-center justify-center bg-black/50 text-white/90 group-hover:flex">
                        <ImagePlus size={20} />
                      </span>
                    </button>
                    <input
                      ref={editorCoverInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onEditorCoverUpload(e.target.files?.[0] || null)}
                    />
                    <button
                      type="button"
                      onClick={() => setEditorCover('')}
                      className="w-full rounded-full bg-white/8 px-3 py-1.5 text-xs text-white hover:bg-white/12"
                    >
                      Remove Image
                    </button>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[11px] text-[#9ca0a8]">Playlist Name</label>
                      <input
                        value={editorName}
                        onChange={(e) => setEditorName(e.target.value)}
                        placeholder="My Playlist"
                        className="w-full rounded-xl bg-white/8 px-3 py-2 text-sm text-white outline-none placeholder:text-[#8c9097]"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-[#9ca0a8]">Description</label>
                      <textarea
                        value={editorDescription}
                        onChange={(e) => setEditorDescription(e.target.value)}
                        placeholder="Add notes, vibe, mood, purpose..."
                        rows={5}
                        className="w-full rounded-xl bg-white/8 px-3 py-2 text-sm text-white outline-none placeholder:text-[#8c9097]"
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={savePlaylistFromEditor}
                        className="rounded-full bg-white/14 px-4 py-2 text-xs text-white hover:bg-white/20"
                      >
                        {playlistEditorMode === 'create' ? 'Create Playlist' : 'Save Changes'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setView('playlist')}
                        className="rounded-full bg-white/8 px-4 py-2 text-xs text-white hover:bg-white/12"
                      >
                        Back to Playlist
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <div className="mx-auto max-w-[1180px] pb-16">
              <section className="mb-5">
                <form
                  className="search-shell flex items-center gap-3 rounded-full px-5 py-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void runSearch(searchQuery);
                  }}
                >
                  <Search size={22} className="text-[#8f939a]" />
                  <input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search songs, artists, playlists"
                    className="w-full bg-transparent text-[34px] font-semibold text-white outline-none placeholder:text-[#7b7e85] sm:text-[30px]"
                  />
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-[#a3a7ae] hover:bg-white/10"
                    aria-label="Clear"
                  >
                    <X size={20} />
                  </button>
                  <button type="submit" className="rounded-full bg-white/10 px-4 py-2 text-xs text-white hover:bg-white/15">
                    {searchLoading ? '...' : 'Search'}
                  </button>
                </form>

                <div className="mt-4 flex flex-wrap gap-2">
                  <SearchPill label="All" active={searchTab === 'all'} onClick={() => setSearchTab('all')} />
                  <SearchPill label="Songs" active={searchTab === 'songs'} onClick={() => setSearchTab('songs')} />
                  <SearchPill label="Albums" active={searchTab === 'albums'} onClick={() => setSearchTab('albums')} />
                  <SearchPill label="Artists" active={searchTab === 'artists'} onClick={() => setSearchTab('artists')} />
                </div>
                {searchError && <p className="mt-2 text-xs text-[#ff8e8e]">{searchError}</p>}
              </section>

              <section className="space-y-5">
                {searchResults.length === 0 ? (
                  <div className="glass px-4 py-6 text-sm text-[#8b8e95]">
                    {searchLoading ? 'Fetching tracks...' : 'No results yet. Try searching for a song or artist.'}
                  </div>
                ) : (
                  <>
                    {searchTab === 'all' && (
                      <div className="grid gap-6 lg:grid-cols-[1fr_1.45fr]">
                        <div>
                          <p className="mb-3 text-[30px] font-semibold text-[#9ea2a8]">TOP RESULT</p>
                          {topSearchResult && (
                            <>
                              <button
                                onClick={() => void selectTrack(topSearchResult)}
                                className="search-card w-full rounded-3xl p-6 text-left transition hover:bg-white/[0.08]"
                              >
                                <SmartThumbnail
                                  src={topSearchResult.cover}
                                  fallbackSrc={topSearchResult.coverFallback}
                                  alt={topSearchResult.title}
                                  className="h-[148px] w-[148px] rounded-2xl object-cover object-center"
                                />
                                <h3 className="mt-4 line-clamp-2 text-[50px] font-semibold leading-[1.02] text-white sm:text-[42px]">
                                  {topSearchResult.title}
                                </h3>
                                <p className="mt-3 text-[26px] text-[#9a9da3] sm:text-[20px]">
                                  {topSearchResult.album || topSearchResult.artist} ï¿½ {topSearchResult.artist}
                                </p>
                              </button>
                              <button
                                type="button"
                                onClick={() => addSongToPlaylistFromAnywhere(topSearchResult)}
                                className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/15"
                              >
                                <FolderPlus size={13} />
                                Add to Playlist
                              </button>
                            </>
                          )}
                        </div>

                        <div>
                          <p className="mb-3 text-[30px] font-semibold text-[#9ea2a8]">SONGS</p>
                          <div className="space-y-2">
                            {searchResults.slice(0, 5).map((song) => (
                              <div
                                key={`right-${song.id}`}
                                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-white/[0.05]"
                              >
                                <button
                                  type="button"
                                  onClick={() => void selectTrack(song)}
                                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                                >
                                  <SmartThumbnail
                                    src={song.cover}
                                    fallbackSrc={song.coverFallback}
                                    alt={song.title}
                                    className="h-11 w-11 rounded-md object-cover object-center"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-[31px] font-medium text-white sm:text-[16px]">{song.title}</p>
                                    <p className="truncate text-[25px] text-[#969aa1] sm:text-[14px]">{song.artist}</p>
                                  </div>
                                  <span className="text-[24px] text-[#8c9097] sm:text-[14px]">{formatDuration(song.durationSec)}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => addSongToPlaylistFromAnywhere(song)}
                                  className="rounded-full p-1.5 text-[#a4a8af] hover:bg-white/[0.08]"
                                  aria-label="Add to playlist"
                                >
                                  <FolderPlus size={15} />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {searchTab === 'albums' && (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {uniqueAlbums.slice(0, 18).map((album) => (
                          <div key={album} className="rounded-2xl bg-white/[0.05] px-4 py-3 text-[15px] text-[#d6d8dc]">
                            {album}
                          </div>
                        ))}
                      </div>
                    )}

                    {searchTab === 'artists' && (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {uniqueArtists.slice(0, 18).map((artist) => (
                          <div key={artist} className="rounded-2xl bg-white/[0.05] px-4 py-3 text-[15px] text-[#d6d8dc]">
                            {artist}
                          </div>
                        ))}
                      </div>
                    )}

                    {(searchTab === 'all' || searchTab === 'songs') && (
                      <div className="search-list rounded-3xl px-5 py-3">
                        {searchResults.map((song) => (
                          <button
                            key={`table-${song.id}`}
                            onClick={() => void selectTrack(song)}
                            className="grid w-full grid-cols-[44px_1fr_auto_auto_auto_auto] items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.05]"
                          >
                            <SmartThumbnail
                              src={song.cover}
                              fallbackSrc={song.coverFallback}
                              alt={song.title}
                              className="h-11 w-11 rounded-md object-cover object-center"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-[16px] text-[#f1f2f4]">{song.title}</p>
                              <p className="truncate text-[14px] text-[#8f939a]">{song.artist}</p>
                            </div>
                            <p className="hidden w-[180px] truncate text-right text-[14px] text-[#8e9299] lg:block">{song.album || '--'}</p>
                            <p className="w-[70px] text-right text-[14px] text-[#8e9299]">{song.streams || '--'}</p>
                            <p className="w-[52px] text-right text-[14px] text-[#8e9299]">{formatDuration(song.durationSec)}</p>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                addSongToPlaylistFromAnywhere(song);
                              }}
                              className="justify-self-end rounded-full p-1.5 text-[#9aa0a8] hover:bg-white/[0.08]"
                              aria-label="Add to playlist"
                            >
                              <FolderPlus size={15} />
                            </button>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </section>
            </div>
          )}
        </main>
      </div>

      <footer className={`player-float fixed bottom-3 left-1/2 z-20 w-[min(760px,95vw)] -translate-x-1/2 overflow-hidden rounded-2xl px-4.5 py-3 ${isExpandedPlayer ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>
        <div className="space-y-2">
          <div className="grid items-center gap-2 md:grid-cols-[210px_1fr] xl:grid-cols-[210px_1fr_210px]">
            <div className="hidden min-w-0 items-center gap-3 md:flex md:w-[210px]">
              <SmartThumbnail
                src={currentTrack?.cover || ''}
                fallbackSrc={currentTrack?.coverFallback || 'https://picsum.photos/seed/player/64/64'}
                alt="Playing now"
                className="h-12 w-12 rounded-md object-cover object-center"
              />
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-[#f2f2f3]">{currentTrack?.title || 'Choose a track'}</p>
                <p className="truncate text-[10.5px] text-[#8b8b90]">{currentTrack?.artist || 'No artist selected'}</p>
              </div>
            </div>

            <div className="hide-scrollbar min-w-0 overflow-x-auto">
              <div className="flex items-center justify-center gap-2.5 text-[#dadadd] md:gap-3.5">
              <button
                className={`player-icon-btn ${isShuffle ? 'text-white' : ''}`}
                onClick={() => setIsShuffle((prev) => !prev)}
                aria-label="Shuffle"
                title="Shuffle"
              >
                <Shuffle size={14} />
              </button>
              <button className="player-icon-btn" onClick={playPrev} aria-label="Previous" disabled={!currentTrack}>
                <SkipBack size={14} />
              </button>
              <button
                className="player-main-btn flex h-10 w-10 items-center justify-center rounded-full bg-white text-black disabled:opacity-50"
                onClick={() => void togglePlay()}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                disabled={!currentTrack}
              >
                {isPlaying ? <Pause size={15} /> : <Play size={15} className="translate-x-[0.5px]" fill="black" />}
              </button>
              <button className="player-icon-btn" onClick={playNext} aria-label="Next" disabled={!currentTrack}>
                <SkipForward size={14} />
              </button>
              <button className="player-icon-btn" aria-label="Queue">
                <ListMusic size={14} />
              </button>
              </div>
            </div>

            <div className="hidden items-center justify-end gap-2 xl:flex">
              <button
                className={`player-icon-btn ${currentTrack && likedTrackIds.has(currentTrack.id) ? 'text-white' : ''}`}
                onClick={() => currentTrack && toggleLiked(currentTrack.id, currentTrack)}
                aria-label="Like current track"
              >
                <Heart size={14} fill={currentTrack && likedTrackIds.has(currentTrack.id) ? 'currentColor' : 'none'} />
              </button>
              <button className="player-icon-btn" aria-label="Queue list">
                <ListMusic size={14} />
              </button>
              <button
                className="player-icon-btn"
                onClick={() => currentTrack && addSongToPlaylistFromAnywhere(currentTrack)}
                aria-label="Add current track to playlist"
              >
                <FolderPlus size={14} />
              </button>
              <button className="player-icon-btn" aria-label="Player settings">
                <SlidersHorizontal size={14} />
              </button>
              <button className="player-icon-btn" onClick={() => setIsMuted((prev) => !prev)} aria-label="Mute">
                {isMuted || volume === 0 ? <VolumeX size={14} className="text-[#aaaab0]" /> : <Volume2 size={14} className="text-[#aaaab0]" />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  setIsMuted(v === 0);
                }}
                className="volume-range w-[92px]"
                aria-label="Volume"
              />
              <button className="player-icon-btn" aria-label="Fullscreen" onClick={() => setIsExpandedPlayer(true)}>
                <Maximize2 size={13} />
              </button>
            </div>
          </div>

          <div className="flex w-full items-center gap-2 text-[10px] text-[#88888d]">
            <span>{formatDuration(currentTime)}</span>
            <button
              type="button"
              className="relative h-1 flex-1 rounded-full bg-white/12"
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                const ratio = (e.clientX - rect.left) / rect.width;
                seekTo(ratio);
              }}
              aria-label="Seek"
            >
              <div className="absolute inset-y-0 left-0 rounded-full bg-white/95" style={{ width: `${progress}%` }} />
            </button>
            <span>{formatDuration(duration || currentTrack?.durationSec || 0)}</span>
          </div>

          <p className="truncate text-[10px] text-[#6f6f74]">{error || status}{activeSource ? ` ï¿½ ${new URL(activeSource).hostname}` : ''}</p>
        </div>
      </footer>
    </div>
  );
}

function SidebarItem({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${
        active ? 'bg-white/12 text-white' : 'hover:bg-white/8'
      }`}
    >
      <span className="text-[#a9a9ad]">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function SearchPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-5 py-2 text-[15px] font-medium transition ${
        active ? 'bg-white text-black' : 'bg-white/[0.07] text-[#d2d4d8] hover:bg-white/[0.11]'
      }`}
    >
      {label}
    </button>
  );
}

function SmartThumbnail({
  src,
  fallbackSrc,
  alt,
  className,
}: {
  src: string;
  fallbackSrc?: string;
  alt: string;
  className: string;
}) {
  const [active, setActive] = useState(src || fallbackSrc || 'https://picsum.photos/seed/fallback-cover/400/400');

  useEffect(() => {
    setActive(src || fallbackSrc || 'https://picsum.photos/seed/fallback-cover/400/400');
  }, [src, fallbackSrc]);

  return (
    <img
      src={active}
      alt={alt}
      className={className}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        if (active !== fallbackSrc && fallbackSrc) {
          setActive(fallbackSrc);
          return;
        }
        setActive('https://picsum.photos/seed/fallback-cover/400/400');
      }}
    />
  );
}

function mapSaavnSongs(items: unknown): Song[] {
  if (!Array.isArray(items)) {
    return [];
  }

  const songs: Song[] = [];

  for (const raw of items as SaavnSong[]) {
    const id = String(raw.id || '').trim();
    if (!id) {
      continue;
    }

    const title = decodeHtml(String(raw.name || raw.title || 'Untitled'));
    const artist = extractSaavnArtist(raw);
    const durationSec = Number(raw.duration || 0);
    const playCount = Number(raw.playCount || 0);
    const cover = pickSaavnImage(raw.image);
    const candidates = getSaavnAudioCandidates(raw.downloadUrl);
    const albumName = typeof raw.album === 'string' ? raw.album : raw.album?.name || '';

    songs.push({
      id,
      title,
      artist,
      cover,
      coverFallback: cover,
      durationSec,
      streams: formatViews(playCount),
      album: decodeHtml(albumName || artist),
      viewCountRaw: playCount,
      audioCandidates: candidates,
      sourceType: 'saavn',
    });
  }

  return songs;
}

function dedupeSongs(items: Song[]): Song[] {
  const seen = new Set<string>();
  const out: Song[] = [];

  for (const item of items) {
    if (!item.id || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    out.push(item);
  }

  return out;
}

function dedupeByLabel(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

function isLikelyActualSong(song: Song): boolean {
  const t = `${song.title} ${song.artist}`.toLowerCase();
  const duration = Number(song.durationSec || 0);

  const blockedTerms = [
    'mashup',
    'jukebox',
    'playlist',
    'non stop',
    'nonstop',
    'all in one',
    'megamix',
    'medley',
    'top 10',
    'top 20',
    'top 50',
    'best songs',
    'live stream',
    '24/7',
    'reels viral',
    'lofi',
    '#',
    '|',
  ];

  if (blockedTerms.some((term) => t.includes(term))) {
    return false;
  }

  // Keep song-like durations; remove long compilations and very short snippets.
  if (duration > 0 && (duration < 80 || duration > 560)) {
    return false;
  }

  return true;
}

function extractSaavnSearchResults(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const results = (data as { results?: unknown[] }).results;
  return Array.isArray(results) ? results : [];
}

function extractSaavnPlaylistSongs(data: unknown): unknown[] {
  if (!data || typeof data !== 'object') {
    return [];
  }
  const songs = (data as { songs?: unknown[] }).songs;
  return Array.isArray(songs) ? songs : [];
}

async function fetchSaavn(path: string): Promise<{ data: unknown; base: string }> {
  const route = path.startsWith('/') ? path : `/${path}`;
  const url = `${saavnBase}${route}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    if (DEBUG_AUDIO) {
      console.debug('[api] trying', url);
    }
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json,text/plain,*/*',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`${url} returned ${res.status}`);
    }

    const payload = (await res.json()) as { success?: boolean; data?: unknown; message?: string };
    if (payload.success !== true) {
      throw new Error(payload.message || 'Saavn request failed');
    }

    if (DEBUG_AUDIO) {
      console.debug('[api] success', url);
    }
    return { data: payload.data, base: saavnBase };
  } finally {
    clearTimeout(timeout);
  }
}

function extractSaavnArtist(song: SaavnSong): string {
  const fromPrimary = (song.artists?.primary || [])
    .map((a) => decodeHtml(String(a.name || '').trim()))
    .filter(Boolean);
  if (fromPrimary.length) {
    return fromPrimary.slice(0, 3).join(', ');
  }

  const fromAll = (song.artists?.all || [])
    .map((a) => decodeHtml(String(a.name || '').trim()))
    .filter(Boolean);
  if (fromAll.length) {
    return fromAll.slice(0, 3).join(', ');
  }

  const csv = String(song.primaryArtists || song.singers || '').trim();
  if (csv) {
    return decodeHtml(csv);
  }
  return 'Unknown Artist';
}

function pickSaavnImage(image: SaavnSong['image']): string {
  if (Array.isArray(image) && image.length) {
    const ordered = [...image].sort((a, b) => pixelQualityRank(b.quality) - pixelQualityRank(a.quality));
    const best = normalizeThumbUrl(ordered[0]?.url);
    if (best) {
      return best;
    }
  }

  if (typeof image === 'string') {
    const direct = normalizeThumbUrl(image.trim());
    if (direct) {
      return direct;
    }
  }

  return 'https://picsum.photos/seed/fallback-cover/400/400';
}

function getSaavnAudioCandidates(downloadUrl: SaavnSong['downloadUrl']): string[] {
  if (!Array.isArray(downloadUrl)) {
    return [];
  }

  const ranked = [...downloadUrl].sort((a, b) => parseKbps(b.quality) - parseKbps(a.quality));
  const urls = ranked
    .map((entry) => normalizeStreamUrl(String(entry.url || '').trim()))
    .filter(Boolean);

  return Array.from(new Set(urls));
}

function parseKbps(quality?: string): number {
  const match = String(quality || '').match(/(\d+)/);
  return match?.[1] ? Number(match[1]) : 0;
}

function normalizeThumbUrl(url?: string): string {
  if (!url) {
    return '';
  }
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  return url;
}

function qualityRank(quality?: string): number {
  const value = (quality || '').toLowerCase();
  if (value.includes('maxres')) return 6;
  if (value.includes('sddefault')) return 5;
  if (value.includes('high')) return 4;
  if (value.includes('medium')) return 3;
  if (value.includes('default')) return 2;
  if (value.includes('start')) return 1;
  return 0;
}

function pixelQualityRank(quality?: string): number {
  const text = String(quality || '').toLowerCase();
  const match = text.match(/(\d+)\s*x\s*(\d+)/);
  if (match?.[1] && match?.[2]) {
    return Number(match[1]) * Number(match[2]);
  }
  return qualityRank(text);
}

async function probeAudioSource(audio: HTMLAudioElement, url: string, timeoutMs: number): Promise<void> {
  audio.pause();
  audio.src = url;
  audio.currentTime = 0;
  audio.load();
  await waitForAudioReady(audio, timeoutMs);
}

function waitForAudioReady(audio: HTMLAudioElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Audio source timeout'));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve();
    };

    const onError = () => {
      cleanup();
      reject(new Error('Audio source error'));
    };

    function cleanup() {
      clearTimeout(timeout);
      audio.removeEventListener('canplay', onReady);
      audio.removeEventListener('loadeddata', onReady);
      audio.removeEventListener('loadedmetadata', onReady);
      audio.removeEventListener('error', onError);
    }

    audio.addEventListener('canplay', onReady, { once: true });
    audio.addEventListener('loadeddata', onReady, { once: true });
    audio.addEventListener('loadedmetadata', onReady, { once: true });
    audio.addEventListener('error', onError, { once: true });
  });
}

function normalizeStreamUrl(url: string): string {
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  return url;
}

function toPlaybackUrl(url: string): string {
  if (!url || typeof window === 'undefined') {
    return url;
  }
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('saavncdn.com')) {
      return url;
    }
    const proxyBase = import.meta.env.DEV ? '/audio-proxy' : '/api/audio-proxy';
    return `${proxyBase}?url=${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
}

function formatViews(viewCount?: number): string {
  if (!viewCount) {
    return '--';
  }
  if (viewCount >= 1_000_000_000) return `${(viewCount / 1_000_000_000).toFixed(1)}B`;
  if (viewCount >= 1_000_000) return `${(viewCount / 1_000_000).toFixed(1)}M`;
  if (viewCount >= 1_000) return `${(viewCount / 1_000).toFixed(1)}K`;
  return String(viewCount);
}

function formatDuration(totalSeconds?: number): string {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds || 0)));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/ï¿½/g, '');
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export default App;










