// esbuild's `binary` loader hands a PNG over as its bytes.
declare module '*.png' {
  const bytes: Uint8Array;
  export default bytes;
}

// The same for an MP3: the bundled board sounds arrive as their bytes.
declare module '*.mp3' {
  const bytes: Uint8Array;
  export default bytes;
}
