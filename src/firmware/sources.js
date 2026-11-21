// Where firmware updates come from, and turning their lists into channels.
// Official, Momentum and Unleashed run the same update server software
// ("directory.json"); GitHub releases are the fallback.

export const FIRMWARES = [
  {
    id: 'momentum',
    name: 'Momentum',
    about: 'Feature-packed custom firmware with asset packs and lots of settings.',
    directory: ['https://up.momentum-fw.dev/firmware/directory.json'],
    github: 'Next-Flip/Momentum-Firmware',
    fork: /momentum|mntm/i,
  },
  {
    id: 'official',
    name: 'Official',
    about: 'The firmware from Flipper Devices.',
    directory: ['https://update.flipperzero.one/firmware/directory.json'],
    github: 'flipperdevices/flipperzero-firmware',
    fork: /^$|official|flipper devices/i,
  },
  {
    id: 'unleashed',
    name: 'Unleashed',
    about: 'Custom firmware focused on Sub-GHz and radio features.',
    directory: ['https://up.unleashedflip.com/directory.json', 'https://up.unleashedflip.com/firmware/directory.json'],
    github: 'DarkFlippers/unleashed-firmware',
    fork: /unleashed/i,
  },
  {
    id: 'roguemaster',
    name: 'RogueMaster',
    about: 'Custom firmware with many extra apps built in.',
    directory: [],
    github: 'RogueMaster/flipperzero-firmware-wPlugins',
    fork: /rogue/i,
  },
];

const CHANNEL_NAMES = {
  release: 'stable',
  'release-candidate': 'release candidate',
  rc: 'release candidate',
  development: 'dev (newest, may have bugs)',
  dev: 'dev (newest, may have bugs)',
};
const CHANNEL_ORDER = ['release', 'release-candidate', 'rc', 'development', 'dev'];

export const channelName = (id, title) => CHANNEL_NAMES[id] ?? title ?? id;

function sortChannels(list) {
  const rank = (c) => (CHANNEL_ORDER.includes(c.id) ? CHANNEL_ORDER.indexOf(c.id) : 99);
  return list.filter((c) => c.versions.length).sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

/** Update server list → [{ id, title, versions: [{ version, changelog, date, url, sha256 }] }] */
export function parseDirectory(json, target = 'f7') {
  const channels = (json?.channels ?? []).map((c) => ({
    id: String(c.id ?? ''),
    title: channelName(String(c.id ?? ''), c.title),
    versions: (c.versions ?? [])
      .map((v) => {
        const file = (v.files ?? []).find((f) => f.type === 'update_tgz' && (f.target === target || f.target === 'any'));
        return file && {
          version: String(v.version ?? ''),
          changelog: String(v.changelog ?? ''),
          date: v.timestamp ? new Date(Number(v.timestamp) * 1000).toISOString().slice(0, 10) : '',
          url: file.url,
          sha256: file.sha256 ?? null,
        };
      })
      .filter(Boolean),
  }));
  return sortChannels(channels);
}

/** GitHub releases → stable and release candidate channels. */
export function parseGithubReleases(list, target = 'f7') {
  const pick = (r) => {
    const assets = (r.assets ?? []).filter((a) => /update.*\.tgz$/i.test(a.name));
    const asset = assets.find((a) => a.name.includes(`-${target}-`) || a.name.includes(`${target}-update`)) ?? assets[0];
    return asset && {
      version: r.tag_name,
      changelog: String(r.body ?? ''),
      date: (r.published_at ?? '').slice(0, 10),
      url: asset.browser_download_url,
      sha256: /^sha256:/.test(asset.digest ?? '') ? asset.digest.slice(7) : null,
    };
  };
  const live = (list ?? []).filter((r) => !r.draft);
  return sortChannels([
    { id: 'release', title: channelName('release'), versions: live.filter((r) => !r.prerelease).map(pick).filter(Boolean) },
    { id: 'release-candidate', title: channelName('release-candidate'), versions: live.filter((r) => r.prerelease).map(pick).filter(Boolean) },
  ]);
}

/** Channels for one firmware: the update server first, GitHub releases if that fails. */
export async function loadChannels(http, fw) {
  const errors = [];
  for (const url of fw.directory) {
    try {
      const channels = parseDirectory(await http.json(url));
      if (channels.length) return { channels, from: new URL(url).host };
    } catch (e) {
      errors.push(e.message);
    }
  }
  try {
    const channels = parseGithubReleases(await http.json(`https://api.github.com/repos/${fw.github}/releases?per_page=20`));
    if (channels.length) return { channels, from: 'GitHub' };
  } catch (e) {
    errors.push(e.message);
  }
  throw new Error(`Couldn't get the ${fw.name} list. ${errors[errors.length - 1] ?? ''}`.trim());
}

/** Which firmware the Flipper runs, from its device info. */
export function currentFirmware(info) {
  const fork = info.firmware_origin_fork ?? '';
  const fw = FIRMWARES.find((x) => x.id !== 'official' && x.fork.test(fork)) ?? (fork && !/official/i.test(fork) ? null : FIRMWARES.find((x) => x.id === 'official'));
  return {
    firmware: fw,
    label: [fork || (fw?.name ?? ''), info.firmware_version, info.firmware_branch && info.firmware_branch !== info.firmware_version ? `(${info.firmware_branch})` : ''].filter(Boolean).join(' '),
    version: info.firmware_version ?? '',
    commit: info.firmware_commit ?? '',
    date: info.firmware_build_date ?? '',
  };
}
