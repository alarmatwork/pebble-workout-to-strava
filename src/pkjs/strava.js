// Strava API client: OAuth tokens, TCX file building and uploads.

var store = require('./store');

var API = 'https://www.strava.com/api/v3';
var TOKEN_URL = 'https://www.strava.com/oauth/token';
var SCOPE = 'activity:write,activity:read_all';

function request(method, url, options, callback) {
  var xhr = new XMLHttpRequest();
  xhr.open(method, url, true);
  var headers = options.headers || {};
  Object.keys(headers).forEach(function (name) {
    xhr.setRequestHeader(name, headers[name]);
  });
  xhr.timeout = 60000;
  xhr.onload = function () {
    var body = null;
    try {
      body = JSON.parse(xhr.responseText);
    } catch (e) {
      body = { message: xhr.responseText };
    }
    if (xhr.status >= 200 && xhr.status < 300) {
      callback(null, body);
    } else {
      callback(new Error(describeError(xhr.status, body)), body);
    }
  };
  xhr.onerror = function () {
    callback(new Error('No internet connection?'));
  };
  xhr.ontimeout = function () {
    callback(new Error('Strava did not answer in time.'));
  };
  xhr.send(options.body || null);
}

function describeError(status, body) {
  if (status === 401) {
    return 'Strava login expired. Reconnect in the app settings.';
  }
  if (status === 429) {
    return 'Strava rate limit reached. Try again in 15 minutes.';
  }
  var message = (body && body.message) || ('HTTP ' + status);
  if (body && body.errors && body.errors.length) {
    message += ': ' + body.errors.map(function (e) {
      return [e.resource, e.field, e.code].filter(Boolean).join(' ');
    }).join(', ');
  }
  return message;
}

function formEncode(fields) {
  return Object.keys(fields).map(function (key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(fields[key]);
  }).join('&');
}

// --- OAuth ------------------------------------------------------------------

function authorizeUrl(settings, state) {
  return 'https://www.strava.com/oauth/authorize?' + formEncode({
    client_id: settings.clientId,
    redirect_uri: settings.callbackUrl,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: SCOPE,
    state: state
  });
}

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
    body: formEncode({
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
    body: formEncode({
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
    body: formEncode({ access_token: tokens.accessToken })
  }, function () {
    if (callback) {
      callback();
    }
  });
}

// --- TCX --------------------------------------------------------------------

function isoTime(seconds) {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function tcxSport(sportType) {
  if (/Run$/.test(sportType)) {
    return 'Running';
  }
  if (/Ride$/.test(sportType)) {
    return 'Biking';
  }
  return 'Other';
}

// workout: { start, end, sportType, distance, calories, heartRates[], steps[] }
function buildTcx(workout) {
  var minutes = workout.heartRates.length;
  var totalSteps = workout.steps.reduce(function (a, b) { return a + (b || 0); }, 0);
  var hrValues = workout.heartRates.filter(function (hr) { return hr > 0; });
  var avgHr = hrValues.length
    ? Math.round(hrValues.reduce(function (a, b) { return a + b; }, 0) / hrValues.length)
    : 0;
  var maxHr = hrValues.length ? Math.max.apply(null, hrValues) : 0;

  // Spread the watch's distance estimate over the minutes in proportion to steps.
  var points = [];
  var cumulative = 0;
  for (var i = 0; i <= minutes; i++) {
    var t = Math.min(workout.start + i * 60, workout.end);
    var point = '<Trackpoint><Time>' + isoTime(t) + '</Time>';
    if (workout.distance > 0) {
      point += '<DistanceMeters>' + cumulative.toFixed(1) + '</DistanceMeters>';
    }
    var hr = workout.heartRates[Math.min(i, minutes - 1)];
    if (hr > 0) {
      point += '<HeartRateBpm><Value>' + hr + '</Value></HeartRateBpm>';
    }
    points.push(point + '</Trackpoint>');
    if (i < minutes && totalSteps > 0) {
      cumulative += workout.distance * (workout.steps[i] || 0) / totalSteps;
    }
    if (t >= workout.end) {
      break;
    }
  }

  var lap = '<Lap StartTime="' + isoTime(workout.start) + '">' +
    '<TotalTimeSeconds>' + (workout.end - workout.start) + '</TotalTimeSeconds>' +
    '<DistanceMeters>' + (workout.distance || 0) + '</DistanceMeters>' +
    '<Calories>' + (workout.calories || 0) + '</Calories>' +
    (avgHr ? '<AverageHeartRateBpm><Value>' + avgHr + '</Value></AverageHeartRateBpm>' : '') +
    (maxHr ? '<MaximumHeartRateBpm><Value>' + maxHr + '</Value></MaximumHeartRateBpm>' : '') +
    '<Intensity>Active</Intensity><TriggerMethod>Manual</TriggerMethod>' +
    '<Track>' + points.join('') + '</Track></Lap>';

  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">' +
    '<Activities><Activity Sport="' + tcxSport(workout.sportType) + '">' +
    '<Id>' + isoTime(workout.start) + '</Id>' + lap +
    '<Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<Name>Pebble</Name></Creator>' +
    '</Activity></Activities></TrainingCenterDatabase>';
}

// --- Upload -----------------------------------------------------------------

function multipart(fields, file) {
  var boundary = '----PebbleWorkout' + Date.now().toString(16);
  var parts = Object.keys(fields).map(function (name) {
    return '--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' +
      fields[name] + '\r\n';
  });
  parts.push('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' +
    file.name + '"\r\nContent-Type: application/xml\r\n\r\n' + file.content + '\r\n');
  return {
    contentType: 'multipart/form-data; boundary=' + boundary,
    body: parts.join('') + '--' + boundary + '--\r\n'
  };
}

function activityName(start, sportName) {
  var hour = new Date(start * 1000).getHours();
  var part = hour < 5 ? 'Night'
    : hour < 11 ? 'Morning'
    : hour < 14 ? 'Lunch'
    : hour < 17 ? 'Afternoon'
    : hour < 21 ? 'Evening'
    : 'Night';
  return part + ' ' + sportName;
}

// onProgress(text) is called with short status messages for the watch.
// callback(err, { activityId, duplicate })
function upload(workout, sportName, onProgress, callback) {
  getAccessToken(function (err, token) {
    if (err) {
      return callback(err);
    }
    var form = multipart({
      name: activityName(workout.start, sportName),
      sport_type: workout.sportType,
      data_type: 'tcx',
      external_id: 'pebble-' + workout.start + '.tcx'
    }, { name: 'pebble-' + workout.start + '.tcx', content: buildTcx(workout) });

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
  authorizeUrl: authorizeUrl,
  exchangeCode: exchangeCode,
  connectWithRefreshToken: connectWithRefreshToken,
  disconnect: disconnect,
  upload: upload,
  buildTcx: buildTcx,
  activityName: activityName
};
