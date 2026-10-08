// SPDX-License-Identifier: GPL-2.0

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {GnomatoIndicator} from './ui/indicator.js';

export default class GnomatoExtension extends Extension {
    enable() {
        this._indicator = new GnomatoIndicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
