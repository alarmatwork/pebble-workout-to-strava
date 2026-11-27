<img src="assets/icon.svg" width="64" height="64" alt="">

# Pebble Workout to Strava

Export workouts recorded with the Pebble's built-in **Workout** app to Strava,
with heart rate, steps, distance and calories. You choose the Strava sport type
on the watch, from favorites you pick in the app's settings.

## How it works

1. Record a workout with the built-in Workout app (Run, Walk or Open Workout).
2. Open **Workout to Strava** on the watch. It lists the last 7 days of workouts.
3. Pick a workout, then a sport type. Your default for that Pebble workout type
   is first, then your favorites, then **More types…** with every Strava type.
4. The phone uploads it to Strava. The watch vibrates when it's done, and
   exported workouts are marked `Sent` in the list.

The watch keeps per-minute history for about a week, so export within a few days.

## Setup

### 1. Host the Strava callback page

Strava sends you back to a web page after you log in. That page,
[`docs/strava-callback.html`](docs/strava-callback.html), hands the one-time
login code to the Pebble app. It holds no secrets.

Enable GitHub Pages for this repo: **Settings → Pages → Deploy from a branch →
`main` / `/docs`**. The page will be at

```
https://alarmatwork.github.io/pebble-workout-to-strava/strava-callback.html
```

This is the app's default callback URL. If you host it elsewhere, enter that
URL in the app settings. (GitHub Pages on a private repo needs a paid plan.)

### 2. Create a Strava API app

1. Go to [strava.com/settings/api](https://www.strava.com/settings/api) and create an app.
2. Set **Authorization Callback Domain** to `alarmatwork.github.io`
   (the host of your callback page, without `https://` or a path).
3. Keep the page open; you need the **Client ID** and **Client Secret** next.

A new Strava API app can only be used by its owner, which is all this needs.

### 3. Build and install

Install the [Pebble SDK](https://developer.repebble.com/sdk/), then:

```sh
pebble build
pebble install --phone <your phone's IP>   # or open build/*.pbw on the phone
```

### 4. Configure the app on your phone

Open the Pebble app → **Workout to Strava** → Settings:

1. Under **Strava API app**, enter the Client ID and Client Secret and tap **Save**.
2. Open the settings again and tap **Connect with Strava**. Log in with email and
   password (Google or Apple sign-in may not work inside the settings page) and
   allow the app to upload activities.
3. Choose your **favorite sport types** and their order, and a **default** for
   each Pebble workout type (for example Open Workout → Weight Training). Tap **Save**.

## What gets uploaded

- A TCX file with one point per minute: heart rate and distance.
- Distance is the watch's step-based estimate, spread across the workout by steps.
- Calories are the watch's active calories.
- The name follows Strava's style, e.g. "Evening Weight Training".
- There is no GPS map; the watch doesn't record location.
- Uploading the same workout twice is detected by Strava and reported as
  "already on Strava".

Heart rate is one reading per minute, because that is what Pebble Health stores,
so the Strava chart is smoother than a chest strap's.

## Notes

- Runs and walks that the watch detected on its own also appear in the list,
  because Pebble Health reports them the same way as workouts.
- Your Client Secret is stored only in the Pebble app's storage on your phone.
  That's fine for personal use; to share the app with others, the token
  exchange should move to a small server.

## Project layout

| Path | What |
| --- | --- |
| `src/c/main.c` | Watch UI: workout list, sport type picker, upload progress |
| `src/c/workouts.c` | Reads workouts and per-minute data from Pebble Health |
| `src/c/comm.c` | Sends workout data to the phone, receives settings and status |
| `src/c/settings.c` | Favorites and defaults cached on the watch |
| `src/pkjs/index.js` | Phone side: message handling, settings, upload flow |
| `src/pkjs/strava.js` | Strava OAuth, TCX file, upload |
| `src/pkjs/config_page.js` | The settings page |
| `src/pkjs/sport_types.json` | Strava sport types (the watch's list is generated from it at build time) |
| `docs/strava-callback.html` | OAuth callback page for GitHub Pages |
