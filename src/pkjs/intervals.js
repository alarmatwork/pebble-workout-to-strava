// intervals.icu client: uploads the workout file with a personal API key,
// then sets the sport type (the upload endpoint has no type parameter).

var tcx = require('./tcx');
var http = require('./http');

var API = 'https://intervals.icu/api/v1';

// Activity types intervals.icu knows. Strava types missing here become "Other".
var TYPES = ('Ride Run Swim WeightTraining Hike Walk AlpineSki BackcountrySki Badminton Canoeing ' +
  'Crossfit EBikeRide EMountainBikeRide Elliptical Golf GravelRide TrackRide Handcycle ' +
  'HighIntensityIntervalTraining Hockey IceSkate InlineSkate Kayaking Kitesurf MountainBikeRide ' +
  'Cyclocross NordicSki OpenWaterSwim Padel Pilates Pickleball Racquetball Rugby RockClimbing ' +
  'RollerSki Rowing Sail Skateboard Snowboard Snowshoe Soccer Squash StairStepper StandUpPaddling ' +
  'Surfing TableTennis Tennis TrailRun Transition Velomobile VirtualRide VirtualRow VirtualRun ' +
  'VirtualSki WaterSport Wheelchair Windsurf Workout Yoga Other').split(' ');

function intervalsType(sportType) {
  return TYPES.indexOf(sportType) >= 0 ? sportType : 'Other';
}

function authHeader(apiKey) {
  return 'Basic ' + http.base64('API_KEY:' + apiKey);
}

function describe(err) {
  if (err.status === 401 || err.status === 403) {
    return new Error('intervals.icu did not accept the API key. Check it in the app settings.');
  }
  return err;
}

// Checks the API key; calls back with the athlete name.
function verify(apiKey, callback) {
  http.request('GET', API + '/athlete/0', {
    headers: { Authorization: authHeader(apiKey) }
  }, function (err, body) {
    if (err) {
      return callback(describe(err));
    }
    callback(null, (body && body.name) || '');
  });
}

// callback(err, { activityId, duplicate })
function upload(apiKey, workout, name, onProgress, callback) {
  var auth = authHeader(apiKey);
  var form = http.multipart({}, {
    name: 'pebble-' + workout.start + '.tcx',
    content: tcx.build(workout)
  });
  var query = http.formEncode({
    name: name,
    device_name: 'Pebble',
    external_id: 'pebble-' + workout.start
  });

  onProgress('Uploading to intervals.icu...');
  http.request('POST', API + '/athlete/0/activities?' + query, {
    headers: { Authorization: auth, 'Content-Type': form.contentType },
    body: form.body
  }, function (err, body, status) {
    if (err) {
      return callback(describe(err));
    }
    var activities = (body && body.activities) || [];
    var activityId = activities.length ? activities[0].id : (body && body.id);
    var duplicate = status === 200;
    if (!activityId) {
      return duplicate
        ? callback(null, { activityId: null, duplicate: true })
        : callback(new Error('intervals.icu did not return the new activity.'));
    }
    onProgress('Setting sport type...');
    http.request('PUT', API + '/activity/' + activityId, {
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: intervalsType(workout.sportType), name: name })
    }, function (err) {
      if (err) {
        return callback(new Error('Uploaded, but setting the sport type failed: ' + describe(err).message));
      }
      callback(null, { activityId: activityId, duplicate: duplicate });
    });
  });
}

module.exports = { verify: verify, upload: upload, intervalsType: intervalsType };
