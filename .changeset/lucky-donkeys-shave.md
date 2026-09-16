---
"@staffroom/server": patch
"@staffroom/web": patch
---

Show what the office is connected to, and whether it is working, in the header.

Each connector is a 24px chip with a health dot: green when it is working, amber
when it needs signing in to, red when it is not answering, struck through when it
has been denied. Anything the owner can fix sorts to the front. Hovering or
focusing a chip opens a card with the server's name, its state in plain English,
any error message, how many tools it has and who can use them — the state is
never carried by colour alone.

An amber connector gets a Connect button, which completes the OAuth sign-in that
was already implemented but had no way to be started from the office; a red one
gets Try again.
