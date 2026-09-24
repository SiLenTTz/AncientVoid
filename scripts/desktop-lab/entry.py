#!/usr/bin/env python3
"""EPIC-P11 lab: a text field that prints its text on Enter and empties.

    entry.py <title> [--password] [--gtk3]

GTK4 by default; --gtk3 for the older toolkit (a separate test cell: in the
headless sway lab, wtype's keys do not reach GTK3 fields — messlauf P11).
"""
import sys
import gi

GTK3 = "--gtk3" in sys.argv
gi.require_version("Gtk", "3.0" if GTK3 else "4.0")
from gi.repository import GLib, Gtk  # noqa: E402

title = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "UACC-Lab"
password = "--password" in sys.argv


def done(e):
    print(e.get_text(), flush=True)
    e.set_text("")


if GTK3:
    win = Gtk.Window(title=title)
    entry = Gtk.Entry()
    if password:
        entry.set_visibility(False)
        entry.set_input_purpose(Gtk.InputPurpose.PASSWORD)
    entry.connect("activate", done)
    win.add(entry)
    win.connect("destroy", Gtk.main_quit)
    win.show_all()
    Gtk.main()
else:
    loop = GLib.MainLoop()
    win = Gtk.Window(title=title)
    entry = Gtk.PasswordEntry() if password else Gtk.Entry()
    entry.connect("activate", done)
    win.set_child(entry)
    win.connect("close-request", lambda *_: loop.quit())
    win.present()
    entry.grab_focus()
    loop.run()
