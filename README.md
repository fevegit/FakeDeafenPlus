# FakeDeafen

FakeDeafen makes Discord publish your voice state as deafened without engaging the local mute or deafen controls, allowing you to keep hearing and talking.

## Features

- Independent Fake Deafen button next to Discord's voice controls.
- No separate Fake Mute mode.
- Configurable activation and deactivation sounds.
- Configurable global keyboard shortcut.
- The global shortcut works while Discord is unfocused or minimized.
- Theme-aware tooltip and control styling.
- Restores the real voice state when disabled.

## Requirements

Custom Vencord plugins require a Vencord installation built from source.

Before continuing, follow the official Vencord source installation guide:

- https://docs.vencord.dev/installing/
- https://docs.vencord.dev/installing/custom-plugins/

You need Git, Node.js and pnpm available in your terminal.

## Manual installation

1. Open your Vencord source folder.
2. Create src/userplugins if it does not already exist.
3. Open a terminal inside src/userplugins.
4. Clone this repository using the exact destination folder shown below:

`sh
git clone https://github.com/fevegit/FakeDeafen.git fakeDeafen
`

5. Return to the Vencord root folder and build it:

`sh
pnpm build
`

6. For Discord Desktop, inject the custom build:

`sh
pnpm inject
`

7. Fully restart Discord.
8. Open **Settings → Vencord → Plugins** and enable **FakeDeafen**.

The plugin folder must end up at:

`	ext
Vencord/src/userplugins/fakeDeafen/
`

## Updating

Open a terminal in the plugin folder and pull the latest version:

`sh
git pull
`

Then return to the Vencord root folder and run:

`sh
pnpm build
pnpm inject
`

Fully restart Discord after rebuilding.

## Uninstalling

1. Disable **FakeDeafen** in Vencord.
2. Delete Vencord/src/userplugins/fakeDeafen.
3. Rebuild and inject Vencord again.
4. Restart Discord.

## Notes

- This is an unofficial custom userplugin and is not supported by the Vencord team.
- Custom plugins require rebuilding Vencord whenever their source changes.
- This repository does not include executables, personal synchronization tools or automatic installation scripts.

## License

GPL-3.0-or-later.