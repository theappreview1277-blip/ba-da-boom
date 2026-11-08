// The sound files the app takes in. WAV goes into the sample pool as it is;
// MP3, FLAC and OGG are decoded and stored as WAV, so projects, the pool and
// collected sample folders only ever hold WAV.

/** File names the app can use as a sample. */
export const SAMPLE_FILE = /\.(wav|mp3|flac|ogg|oga)$/i;
/** Formats that are converted to WAV on the way in. */
export const COMPRESSED_FILE = /\.(mp3|flac|ogg|oga)$/i;
/** For file pickers. */
export const SAMPLE_ACCEPT = '.wav,.mp3,.flac,.ogg,.oga,audio/wav,audio/mpeg,audio/flac,audio/ogg';

/** A file name without its sound-file extension, for showing. */
export const sampleName = (file: string) => file.replace(SAMPLE_FILE, '');
