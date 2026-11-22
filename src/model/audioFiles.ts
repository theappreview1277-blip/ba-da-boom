// The sound files the app takes in. WAV goes into the sample pool as it is;
// MP3, FLAC, OGG and AIFF are decoded and stored as WAV, so projects, the pool and
// collected sample folders only ever hold WAV.

/** File names the app can use as a sample. */
export const SAMPLE_FILE = /\.(wav|mp3|flac|ogg|oga|aiff?|aifc)$/i;
/** Formats that are converted to WAV on the way in. */
export const COMPRESSED_FILE = /\.(mp3|flac|ogg|oga|aiff?|aifc)$/i;
/** AIFF files, which Chromium can't decode, so the app reads them itself. */
export const AIFF_FILE = /\.(aiff?|aifc)$/i;
/** For file pickers. */
export const SAMPLE_ACCEPT = '.wav,.mp3,.flac,.ogg,.oga,.aif,.aiff,.aifc,audio/wav,audio/mpeg,audio/flac,audio/ogg,audio/aiff';

/** A file name without its sound-file extension, for showing. */
export const sampleName = (file: string) => file.replace(SAMPLE_FILE, '');
