// Pick files from Google Drive or Dropbox. Both run entirely in the browser:
// the file comes straight from the provider to this device.
const scripts = new Map();
function loadScript(src, attrs = {}) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
      el.onload = resolve;
      el.onerror = () => { scripts.delete(src); el.remove(); reject(new Error("Couldn't reach the file picker. Check your connection.")); };
      document.head.append(el);
    }));
  }
  return scripts.get(src);
}

const DROPBOX_EXTENSIONS = [".pdf", ".epub", ".docx", ".txt", ".md", ".html", ".htm", ".csv"];

// Resolves to { name, url } or null if cancelled.
export async function chooseFromDropbox(appKey) {
  await loadScript("https://www.dropbox.com/static/api/2/dropins.js", { id: "dropboxjs", "data-app-key": appKey });
  return await new Promise((resolve) => {
    window.Dropbox.choose({
      linkType: "direct",
      multiselect: false,
      extensions: DROPBOX_EXTENSIONS,
      success: (files) => resolve(files[0] ? { name: files[0].name, url: files[0].link } : null),
      cancel: () => resolve(null)
    });
  });
}

const GOOGLE_TYPES = {
  "application/vnd.google-apps.document": { exportAs: "text/plain", ext: ".txt" },
  "application/vnd.google-apps.presentation": { exportAs: "text/plain", ext: ".txt" }
};
const GOOGLE_MIME_FILTER = [
  ...Object.keys(GOOGLE_TYPES),
  "application/pdf", "application/epub+zip", "text/plain", "text/markdown", "text/html", "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
].join(",");

let googleToken = null; // { value, expiresAt }

async function googleAccessToken(clientId) {
  if (googleToken && googleToken.expiresAt > Date.now() + 60000) return googleToken.value;
  await loadScript("https://accounts.google.com/gsi/client");
  return await new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      // drive.file only grants access to the files the person picks.
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (response) => {
        if (response.error) return reject(new Error(response.error_description || "Google sign-in was cancelled."));
        googleToken = { value: response.access_token, expiresAt: Date.now() + Number(response.expires_in || 3000) * 1000 };
        resolve(response.access_token);
      },
      error_callback: (error) => reject(new Error(error?.type === "popup_closed" ? "Google sign-in was closed." : "Google sign-in failed."))
    });
    client.requestAccessToken();
  });
}

// Resolves to { blob, name, title } or null if cancelled.
export async function chooseFromGoogleDrive({ clientId, apiKey, appId }) {
  const [token] = await Promise.all([googleAccessToken(clientId), loadScript("https://apis.google.com/js/api.js")]);
  await new Promise((resolve) => window.gapi.load("picker", resolve));
  const { picker } = window.google;
  const picked = await new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes(GOOGLE_MIME_FILTER).setIncludeFolders(true);
    const builder = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setTitle("Choose something to read")
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs[0]);
        else if (data.action === picker.Action.CANCEL) resolve(null);
      });
    if (appId) builder.setAppId(appId);
    builder.build().setVisible(true);
  });
  if (!picked) return null;

  const special = GOOGLE_TYPES[picked.mimeType];
  const url = special
    ? `https://www.googleapis.com/drive/v3/files/${picked.id}/export?mimeType=${encodeURIComponent(special.exportAs)}`
    : `https://www.googleapis.com/drive/v3/files/${picked.id}?alt=media`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Google Drive wouldn't send that file (${response.status}).`);
  const blob = await response.blob();
  return { blob, name: special ? `${picked.name}${special.ext}` : picked.name, title: picked.name };
}
