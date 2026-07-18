// Save text to a file, letting the user choose the name.
//
// Prefers the native OS "Save As" dialog (File System Access API, Chromium/Edge)
// so the user picks the name and location in the real browser chrome. Falls back
// to a name prompt + a normal download for browsers without the API (Firefox,
// Safari). Everything stays client-side — nothing is uploaded.

export type SaveOutcome = "saved" | "cancelled";

interface SaveFilePicker {
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandleLike>;
}
interface FileSystemFileHandleLike {
  createWritable: () => Promise<{ write: (data: BlobPart) => Promise<void>; close: () => Promise<void> }>;
}

function ensureExt(name: string, ext: string, fallback: string): string {
  const trimmed = name.trim() || fallback;
  return new RegExp(`\\.${ext}$`, "i").test(trimmed) ? trimmed : `${trimmed}.${ext}`;
}

/**
 * Save `text` as a file. Returns whether the user completed or cancelled the save.
 * Must be called from a user gesture (e.g. a click) for the native picker to open.
 */
export async function saveTextFile(
  suggestedName: string,
  text: string,
  mime = "text/csv",
  ext = "csv"
): Promise<SaveOutcome> {
  const blob = new Blob([text], { type: mime });
  const picker = window as unknown as SaveFilePicker;

  if (typeof picker.showSaveFilePicker === "function") {
    let handle: FileSystemFileHandleLike | null = null;
    try {
      handle = await picker.showSaveFilePicker({
        suggestedName,
        types: [{ description: "CSV file", accept: { [mime]: [`.${ext}`] } }],
      });
    } catch (err) {
      // user dismissed the native dialog → treat as cancel, don't double-download
      if (err instanceof DOMException && err.name === "AbortError") return "cancelled";
      // the picker itself is unavailable here (e.g. SecurityError in an iframe /
      // insecure context) → fall through to the download path
    }
    // Once the picker resolves, the target file already exists on disk. A failure
    // while writing must NOT fall through to the download path (that would leave a
    // stray empty file AND download a duplicate); surface it instead.
    if (handle) {
      try {
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return "saved";
      } catch (err) {
        console.error("Could not write the chosen file:", err);
        return "cancelled";
      }
    }
  }

  const name = window.prompt("Save as (file name):", suggestedName);
  if (name === null) return "cancelled";
  const finalName = ensureExt(name, ext, suggestedName);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = finalName;
  a.style.display = "none";
  document.body.appendChild(a); // some browsers ignore .click() on a detached anchor
  a.click();
  a.remove();
  // defer revoke so the download has started reading the blob (Firefox-safe)
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return "saved";
}
