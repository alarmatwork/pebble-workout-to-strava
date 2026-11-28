// Builds a TCX workout file from the per-minute data sent by the watch.

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
function build(workout) {
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

// Names like Strava does: "Evening Weight Training".
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

module.exports = { build: build, activityName: activityName };
