// SPDX-License-Identifier: GPL-2.0

import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export const GnomatoIndicator = GObject.registerClass(
class GnomatoIndicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Gnomato', false);

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        box.add_child(new St.Icon({
            icon_name: 'alarm-symbolic',
            style_class: 'system-status-icon',
        }));
        this.add_child(box);
    }
});
