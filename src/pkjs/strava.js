// Strava API client: OAuth tokens and uploads.
// Note: Strava only serves API apps whose owner has a Strava subscription.

var store = require('./store');
var http = require('./http');
var tcx = require('./tcx');

var API = 'https://www.strava.com/api/v3';
var TOKEN_URL = 'https://www.strava.com/oauth/token';
var SCOPE = 'activity:write,activity:read_all';

function describe(err) {
  if (!err.status) {
    return err;
  }
  if (err.status === 401) {
    return new Error('Strava login expired. Reconnect in the app settings.');
  }
  if (err.status === 429) {
    return new Error('Strava rate limit reached. Try again in 15 minutes.');
  }
  var errors = (err.body && err.body.errors) || [];
  if (errors.some(function (e) { return e.code === 'Inactive'; })) {
    return new Error('Your Strava API app is inactive. Strava requires a subscription for API access.');
  }
  var message = err.message;
  if (errors.length) {
    message += ': ' + errors.map(function (e) {
      return [e.resource, e.field, e.code].filter(Boolean).join(' ');
    }).join(', ');
  }
  return new Error(message);
}

function request(method, url, options, callback) {
  http.request(method, url, options, function (err, body, status) {
    callback(err ? describe(err) : null, body, status);
  });
}

// --- OAuth ------------------------------------------------------------------

function saveTokenResponse(body, previous) {
  var tokens = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: body.expires_at,
    athlete: body.athlete
      ? [body.athlete.firstname, body.athlete.lastname].filter(Boolean).join(' ')
      : (previous && previous.athlete) || ''
  };
  store.saveTokens(tokens);
  return tokens;
}

function exchangeCode(code, callback) {
  var settings = store.getSettings();
  request('POST', TOKEN_URL, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: http.formEncode({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      code: code,
      grant_type: 'authorization_code'
    })
  }, function (err, body) {
    if (err) {
      return callback(err);
    }
    callback(null, saveTokenResponse(body, null));
  });
}

// Calls back with a valid access token, refreshing it when it is about to expire.
function getAccessToken(callback) {
  var tokens = store.getTokens();
  if (!tokens || !tokens.refreshToken) {
    return callback(new Error('Strava is not connected. Open the app settings.'));
  }
  var now = Math.floor(Date.now() / 1000);
  if (tokens.accessToken && tokens.expiresAt - 120 > now) {
    return callback(null, tokens.accessToken);
  }
  var settings = store.getSettings();
  request('POST', TOKEN_URL, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: http.formEncode({
      client_id: settings.clientId,
      client_secret: settings.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken
    })
  }, function (err, body) {
    if (err) {
      return callback(err);
    }
    callback(null, saveTokenResponse(body, tokens).accessToken);
  });
}

// Connects with a refresh token the user created themselves (e.g. with curl),
// for when the login page does not work inside the Pebble app.
function connectWithRefreshToken(refreshToken, callback) {
  var previous = store.getTokens();
  store.saveTokens({ refreshToken: refreshToken, accessToken: '', expiresAt: 0, athlete: '' });
  getAccessToken(function (err, token) {
    if (err) {
      store.saveTokens(previous);
      return callback(new Error('That refresh token did not work: ' + err.message));
    }
    request('GET', API + '/athlete', {
      headers: { Authorization: 'Bearer ' + token }
    }, function (err, athlete) {
      var tokens = store.getTokens();
      if (!err && athlete) {
        tokens.athlete = [athlete.firstname, athlete.lastname].filter(Boolean).join(' ');
        store.saveTokens(tokens);
      }
      callback(null, tokens);
    });
  });
}

function disconnect(callback) {
  var tokens = store.getTokens();
  store.saveTokens(null);
  if (!tokens || !tokens.accessToken) {
    return callback && callback();
  }
  request('POST', 'https://www.strava.com/oauth/deauthorize', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: http.formEncode({ access_token: tokens.accessToken })
  }, function () {
    if (callback) {
      callback();
    }
  });
}

// --- Upload -----------------------------------------------------------------

// onProgress(text) is called with short status messages for the watch.
// callback(err, { activityId, duplicate })
function upload(workout, name, onProgress, callback) {
  getAccessToken(function (err, token) {
    if (err) {
      return callback(err);
    }
    var form = http.multipart({
      name: name,
      sport_type: workout.sportType,
      data_type: 'tcx',
      external_id: 'pebble-' + workout.start + '.tcx'
    }, { name: 'pebble-' + workout.start + '.tcx', content: tcx.build(workout) });

    onProgress('Uploading to Strava...');
    request('POST', API + '/uploads', {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': form.contentType },
      body: form.body
    }, function (err, body) {
      if (err) {
        return callback(err);
      }
      onProgress('Strava is processing...');
      pollUpload(token, body.id_str || body.id, 0, callback);
    });
  });
}

function pollUpload(token, uploadId, attempt, callback) {
  request('GET', API + '/uploads/' + uploadId, {
    headers: { Authorization: 'Bearer ' + token }
  }, function (err, body) {
    if (err) {
      return callback(err);
    }
    if (body.error) {
      var duplicate = /duplicate of (?:<a [^>]*>)?activity (\d+)/i.exec(body.error);
      if (duplicate) {
        return callback(null, { activityId: duplicate[1], duplicate: true });
      }
      return callback(new Error(body.error.replace(/<[^>]+>/g, '')));
    }
    if (body.activity_id) {
      return callback(null, { activityId: String(body.activity_id), duplicate: false });
    }
    if (attempt >= 30) {
      return callback(new Error('Strava is still processing. Check the Strava app shortly.'));
    }
    setTimeout(function () {
      pollUpload(token, uploadId, attempt + 1, callback);
    }, 2000);
  });
}

module.exports = {
  SCOPE: SCOPE,
  exchangeCode: exchangeCode,
  connectWithRefreshToken: connectWithRefreshToken,
  disconnect: disconnect,
  upload: upload
};
