let latestVersion: string | null = null;

export async function checkForUpdate(currentVersion: string): Promise<{ available: boolean; latest: string }> {
  if (!latestVersion) {
    try {
      const res = await fetch('https://registry.npmjs.org/@anthropic-ai/claude-code/latest');
      const data = await res.json();
      latestVersion = data.version;
    } catch {
      return { available: false, latest: currentVersion };
    }
  }
  return {
    available: latestVersion !== currentVersion && latestVersion !== null,
    latest: latestVersion ?? currentVersion,
  };
}
