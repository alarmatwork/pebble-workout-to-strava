<img src="assets/icon.svg" width="64" height="64" alt="">

# Pebble Workout Export

Export workouts recorded with the Pebble's built-in **Workout** app to
[intervals.icu](https://intervals.icu) or Strava, with heart rate, steps,
distance and calories. You choose the sport type on the watch, from favorites
you pick in the app's settings.

## How it works

1. Record a workout with the built-in Workout app (Run, Walk or Open Workout).
2. Open **Workout Export** on the watch. It lists the last 7 days of workouts.
3. Pick a workout, then a sport type. Your default for that Pebble workout type
   is first, then your favorites, then **More types…** with every type.
4. The phone uploads it. The watch vibrates when it's done, and exported
   workouts are marked `Sent` in the list.

The watch keeps per-minute history for about a week, so export within a few days.

## Install

Download the latest `.pbw` from
[Releases](https://github.com/alarmatwork/pebble-workout-to-strava/releases)
on your phone and open it with the Pebble app. Or build it yourself with the
[Pebble SDK](https://developer.repebble.com/sdk/):

```sh
pebble build
pebble install --phone <your phone's IP>   # or open build/*.pbw on the phone
```

## Setup with intervals.icu (default)

1. On intervals.icu, open **Settings**. Near the bottom, under
   **Developer Settings**, copy your **API key**.
2. In the Pebble phone app, open **Workout Export → Settings**. Under
   **Upload to**, choose **intervals.icu**, paste the API key and tap **Save**.
   The phone checks the key and shows "Connected as …".
3. Choose your **favorite sport types** and their order, and a **default** for
   each Pebble workout type (for example Open Workout → Weight Training). Tap **Save**.

intervals.icu uses the same sport type names as Strava. Types it doesn't know
(Basketball, Cricket, Dance, Physical Therapy, Volleyball) are saved as "Other".

## Setup with Strava

Strava only serves API apps whose owner has an **active Strava subscription**.
Without one, every request fails with `403 Application Status Inactive`.

1. **Callback page.** Strava sends you back to a web page after you log in.
   [`docs/strava-callback.html`](docs/strava-callback.html) hands the one-time
   login code to the Pebble app and holds no secrets. It's served by GitHub Pages
   (**Settings → Pages → `main` / `/docs`**) at
   `https://alarmatwork.github.io/pebble-workout-to-strava/strava-callback.html`,
   the app's default callback URL.
2. **Strava API app.** At [strava.com/settings/api](https://www.strava.com/settings/api),
   create an app and set **Authorization Callback Domain** to `alarmatwork.github.io`.
3. **Settings.** Choose **Upload to → Strava**. Under **Strava API app**, enter the
   Client ID and Client Secret and tap **Save**. Open the settings again and tap
   **Connect with Strava**, logging in with email and password.
   If the login page fails inside the Pebble app, open **Or paste a refresh token**
   and paste a `refresh_token` you created yourself with `curl`
   (authorize with `scope=activity:write,activity:read_all`, then exchange the code
   at `https://www.strava.com/oauth/token`).

## What gets uploaded

- A TCX file with one point per minute: heart rate and distance.
- Distance is the watch's step-based estimate, spread across the workout by steps.
- Calories are the watch's active calories.
- The name follows Strava's style, e.g. "Evening Weight Training".
- There is no GPS map; the watch doesn't record location.
- Uploading the same workout twice is detected and reported as "already on …".

Heart rate is one reading per minute, because that is what Pebble Health stores.

## Notes

- Runs and walks that the watch detected on its own also appear in the list,
  because Pebble Health reports them the same way as workouts.
- API keys and the Strava Client Secret are stored only in the Pebble app's
  storage on your phone.

## Project layout

| Path | What |
| --- | --- |
| `src/c/main.c` | Watch UI: workout list, sport type picker, upload progress |
| `src/c/workouts.c` | Reads workouts and per-minute data from Pebble Health |
| `src/c/comm.c` | Sends workout data to the phone, receives settings and status |
| `src/c/settings.c` | Favorites and defaults cached on the watch |
| `src/pkjs/index.js` | Phone side: message handling, settings, upload flow |
| `src/pkjs/intervals.js` | intervals.icu upload |
| `src/pkjs/strava.js` | Strava OAuth and upload |
| `src/pkjs/tcx.js` | Builds the TCX workout file |
| `src/pkjs/http.js` | HTTP helpers (requests, multipart, base64) |
| `src/pkjs/config_page.js` | The settings page |
| `src/pkjs/sport_types.json` | Sport types (the watch's list is generated from it at build time) |
| `docs/strava-callback.html` | Strava OAuth callback page for GitHub Pages |
