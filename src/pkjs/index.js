// Phone side of Workout Export (PebbleKit JS). Uploads go to intervals.icu
// or Strava, whichever is chosen in the settings.
// Protocol with the watch: see src/c/comm.h.

var store = require('./store');
var strava = require('./strava');
var intervals = require('./intervals');
var tcx = require('./tcx');
var configPage = require('./config_page');
var SPORTS = require('./sport_types.json');

var CMD_BEGIN = 1;
var CMD_CHUNK = 2;
var CMD_END = 3;
var STATUS_PROGRESS = 1;
var STATUS_DONE = 2;
var STATUS_ERROR = 3;

var sportNames = {};
SPORTS.forEach(function (s) { sportNames[s.id] = s.name; });

// --- Messages to the watch (queued; the watch handles one at a time) ---------

var queue = [];
var sending = false;

function send(message) {
  queue.push(message);
  if (!sending) {
    sendNext();
  }
}

function sendNext() {
  var message = queue.shift();
  if (!message) {
    sending = false;
    return;
  }
  sending = true;
  Pebble.sendAppMessage(message, sendNext, function (e) {
    console.log('Send to watch failed: ' + JSON.stringify(e && e.error));
    sendNext();
  });
}

// The watch's "connected" flag means "the chosen destination is set up".
function isConnected(settings, tokens) {
  if (settings.destination === 'strava') {
    return !!(tokens && tokens.refreshToken);
  }
  return !!settings.intervalsApiKey;
}

function sendSettings() {
  var settings = store.getSettings();
  var tokens = store.getTokens();
  send({
    Favorites: settings.favorites.join(','),
    DefaultRun: settings.defaults.run,
    DefaultWalk: settings.defaults.walk,
    DefaultWorkout: settings.defaults.workout,
    StravaConnected: isConnected(settings, tokens) ? 1 : 0
  });
}

function sendStatus(status, text) {
  send({ Status: status, StatusText: String(text || '').slice(0, 120) });
}

// --- Workout upload ---------------------------------------------------------

var pending = null;

function handleWatchMessage(payload) {
  switch (payload.Command) {
    case CMD_BEGIN:
      pending = {
        start: payload.StartTime,
        end: payload.EndTime,
        pebbleActivity: payload.PebbleActivity,
        sportType: payload.SportType,
        distance: payload.DistanceM || 0,
        calories: payload.Calories || 0,
        heartRates: new Array(payload.Minutes),
        steps: new Array(payload.Minutes)
      };
      break;
    case CMD_CHUNK:
      if (!pending) {
        return;
      }
      var hr = payload.HeartRates || [];
      var steps = payload.Steps || [];
      for (var i = 0; i < hr.length; i++) {
        pending.heartRates[payload.ChunkOffset + i] = hr[i];
        pending.steps[payload.ChunkOffset + i] = steps[i] || 0;
      }
      break;
    case CMD_END:
      if (pending) {
        var workout = pending;
        pending = null;
        uploadWorkout(workout);
      }
      break;
  }
}

function uploadWorkout(workout) {
  for (var i = 0; i < workout.heartRates.length; i++) {
    workout.heartRates[i] = workout.heartRates[i] || 0;
    workout.steps[i] = workout.steps[i] || 0;
  }
  var settings = store.getSettings();
  var name = tcx.activityName(workout.start, sportNames[workout.sportType] || workout.sportType);
  var useStrava = settings.destination === 'strava';
  var target = useStrava ? 'Strava' : 'intervals.icu';
  var onProgress = function (text) {
    sendStatus(STATUS_PROGRESS, text);
  };
  var done = function (err, result) {
    if (err) {
      console.log('Upload failed: ' + err.message);
      sendStatus(STATUS_ERROR, err.message);
    } else if (result.duplicate) {
      sendStatus(STATUS_DONE, 'It was already on ' + target + '.');
    } else {
      sendStatus(STATUS_DONE, name + ' is on ' + target + '.');
    }
  };
  if (useStrava) {
    strava.upload(workout, name, onProgress, done);
  } else if (!settings.intervalsApiKey) {
    done(new Error('Add your intervals.icu API key in the app settings.'));
  } else {
    intervals.upload(settings.intervalsApiKey, workout, name, onProgress, done);
  }
}

// --- Settings page ----------------------------------------------------------

function randomNonce() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function applySettings(update) {
  var settings = store.getSettings();
  if (update.favorites) {
    settings.favorites = update.favorites.filter(function (id) { return sportNames[id]; });
  }
  if (update.defaults) {
    ['run', 'walk', 'workout'].forEach(function (key) {
      if (sportNames[update.defaults[key]]) {
        settings.defaults[key] = update.defaults[key];
      }
    });
  }
  if (update.destination === 'intervals' || update.destination === 'strava') {
    settings.destination = update.destination;
  }
  if (update.clientId !== undefined) {
    settings.clientId = update.clientId;
  }
  if (update.clientSecret) {
    settings.clientSecret = update.clientSecret;
  }
  if (update.callbackUrl) {
    settings.callbackUrl = update.callbackUrl;
  }
  store.saveSettings(settings);
}

function handleOAuth(result) {
  var state = null;
  try {
    state = JSON.parse(result.state || '');
  } catch (e) {
    state = null;
  }
  var expected = store.read('oauthNonce');
  store.write('oauthNonce', null);
  if (!state || !expected || state.n !== expected) {
    console.log('Ignoring Strava login with an unexpected state.');
    return;
  }
  applySettings({ favorites: state.f, defaults: state.d });

  if (result.error) {
    console.log('Strava login was cancelled: ' + result.error);
    sendSettings();
    return;
  }
  if (!/activity:write/.test(result.scope || '')) {
    console.log('Strava login is missing the activity:write permission.');
    notify('Strava', 'Please allow uploading activities when connecting.');
    sendSettings();
    return;
  }
  strava.exchangeCode(result.code, function (err, tokens) {
    if (err) {
      console.log('Strava token exchange failed: ' + err.message);
      notify('Strava', 'Connecting failed: ' + err.message);
    } else {
      notify('Strava', 'Connected' + (tokens.athlete ? ' as ' + tokens.athlete : '') + '.');
    }
    sendSettings();
  });
}

function notify(title, text) {
  try {
    Pebble.showSimpleNotificationOnPebble(title, text);
  } catch (e) {
    console.log(title + ': ' + text);
  }
}

Pebble.addEventListener('showConfiguration', function () {
  var settings = store.getSettings();
  var tokens = store.getTokens();
  var nonce = randomNonce();
  store.write('oauthNonce', nonce);
  var publicSettings = {
    destination: settings.destination,
    intervalsAthlete: settings.intervalsAthlete,
    clientId: settings.clientId,
    callbackUrl: settings.callbackUrl,
    favorites: settings.favorites,
    defaults: settings.defaults
  };
  Pebble.openURL(configPage.build({
    sports: SPORTS,
    settings: publicSettings,
    hasSecret: !!settings.clientSecret,
    hasIntervalsKey: !!settings.intervalsApiKey,
    connected: !!(tokens && tokens.refreshToken),
    athlete: tokens && tokens.athlete,
    nonce: nonce,
    scope: strava.SCOPE
  }));
});

Pebble.addEventListener('webviewclosed', function (e) {
  if (!e || !e.response) {
    return;
  }
  var result;
  try {
    result = JSON.parse(decodeURIComponent(e.response));
  } catch (err) {
    try {
      result = JSON.parse(e.response);
    } catch (err2) {
      console.log('Could not read settings result.');
      return;
    }
  }
  if (result.action === 'oauth') {
    handleOAuth(result);
    return;
  }
  if (result.settings) {
    applySettings(result.settings);
  }
  if (result.action === 'disconnect') {
    strava.disconnect(sendSettings);
  } else if (result.action === 'intervals-remove') {
    var cleared = store.getSettings();
    cleared.intervalsApiKey = '';
    cleared.intervalsAthlete = '';
    store.saveSettings(cleared);
    sendSettings();
  } else if (result.settings && result.settings.intervalsApiKey) {
    var key = result.settings.intervalsApiKey;
    intervals.verify(key, function (err, athlete) {
      if (err) {
        notify('intervals.icu', err.message);
      } else {
        var settings = store.getSettings();
        settings.intervalsApiKey = key;
        settings.intervalsAthlete = athlete;
        store.saveSettings(settings);
        notify('intervals.icu', 'Connected' + (athlete ? ' as ' + athlete : '') + '.');
      }
      sendSettings();
    });
  } else if (result.settings && result.settings.refreshToken) {
    strava.connectWithRefreshToken(result.settings.refreshToken, function (err, tokens) {
      if (err) {
        notify('Strava', err.message);
      } else {
        notify('Strava', 'Connected' + (tokens.athlete ? ' as ' + tokens.athlete : '') + '.');
      }
      sendSettings();
    });
  } else {
    sendSettings();
  }
});

Pebble.addEventListener('appmessage', function (e) {
  handleWatchMessage(e.payload || {});
});

Pebble.addEventListener('ready', function () {
  sendSettings();
});
