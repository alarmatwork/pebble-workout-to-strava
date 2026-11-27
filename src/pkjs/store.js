// Settings and Strava tokens, kept in the Pebble phone app's localStorage.

var DEFAULT_CALLBACK_URL = 'https://alarmatwork.github.io/pebble-workout-to-strava/strava-callback.html';

var DEFAULT_SETTINGS = {
  clientId: '',
  clientSecret: '',
  callbackUrl: DEFAULT_CALLBACK_URL,
  favorites: ['Run', 'Walk', 'Ride', 'Hike', 'WeightTraining', 'Workout'],
  defaults: { run: 'Run', walk: 'Walk', workout: 'Workout' }
};

function read(key) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function write(key, value) {
  if (value === null) {
    localStorage.removeItem(key);
  } else {
    localStorage.setItem(key, JSON.stringify(value));
  }
}

function getSettings() {
  var stored = read('settings') || {};
  var settings = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
    settings[key] = stored[key] !== undefined ? stored[key] : DEFAULT_SETTINGS[key];
  });
  settings.defaults = {
    run: (stored.defaults && stored.defaults.run) || DEFAULT_SETTINGS.defaults.run,
    walk: (stored.defaults && stored.defaults.walk) || DEFAULT_SETTINGS.defaults.walk,
    workout: (stored.defaults && stored.defaults.workout) || DEFAULT_SETTINGS.defaults.workout
  };
  return settings;
}

function saveSettings(settings) {
  write('settings', settings);
}

function getTokens() {
  return read('stravaTokens');
}

function saveTokens(tokens) {
  write('stravaTokens', tokens);
}

module.exports = {
  DEFAULT_CALLBACK_URL: DEFAULT_CALLBACK_URL,
  getSettings: getSettings,
  saveSettings: saveSettings,
  getTokens: getTokens,
  saveTokens: saveTokens,
  read: read,
  write: write
};
