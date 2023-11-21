import './style.css';
import boxImageUrl from './static/images/distanceInfoBox.png'
import pinImageUrl from './static/images/pin.png'
import createColormap from 'colormap';
import { Map, View } from 'ol';
import { Draw, Modify, Snap } from 'ol/interaction.js';
import { createBox } from 'ol/interaction/Draw.js';
import { OSM, Vector as VectorSource } from 'ol/source.js';
import { LineString, MultiLineString, Point } from 'ol/geom';
import { getCenter } from 'ol/extent';
import Feature from 'ol/Feature.js';
import { Vector as VectorLayer } from 'ol/layer.js';
import { transform, fromLonLat, transformExtent } from 'ol/proj';
import { Style, Fill, Stroke, Icon, Text } from 'ol/style';
import { apply as olms_apply } from 'ol-mapbox-style';
import { getDistance, } from 'ol/sphere';
import { Circle } from 'ol/geom';

// ================ Utility stuff =================//
function getImageUrl(name, ext) {
  return new URL(`./static/images/${name}.${ext}`, import.meta.url).href
}

const getCenterOfStreet = function (streetFeature) {
  const streetGeometry = streetFeature.getGeometry();
  return streetGeometry.getClosestPoint(getCenter(streetGeometry.getExtent()));
}

const getRealDistance = function (p1, p2) {
  let t1 = transform(p1, 'EPSG:3857', 'EPSG:4326');
  let t2 = transform(p2, 'EPSG:3857', 'EPSG:4326');
  // get distance on sphere
  return getDistance(t1, t2);
};

const getRealLineDistance = function (line) {
  const coordinates = line.getCoordinates();

  var dist = 0;
  //loop through all coordinates
  for(var i = 0; i < coordinates.length -1; i++) {
    dist += getRealDistance(coordinates[i], coordinates[i+1])
  }
  // get distance on sphere
  return dist;
}

const formatLength = function (length) {
  let output;
  if (length > 999) {
    output = Math.round((length / 1000) * 100) / 100 + ' ' + 'km';
  } else {
    output = Math.round(length * 100 / 100) + ' ' + 'm';
  }
  return output;
};

function shuffle(array) {
  let currentIndex = array.length,  randomIndex;

  // While there remain elements to shuffle.
  while (currentIndex > 0) {

    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [array[currentIndex], array[randomIndex]] = [
      array[randomIndex], array[currentIndex]];
  }
}

const zoomToExtent = function (extent, _duration) {
  map.getView().fit(extent, { duration: _duration });
}

const weightSum = function(object) {
  let sum = 0;
  object.forEach((element) => {
    sum += element.values_.weight;
  })
  return sum
}

// Sampling from custom discrete distribution
const weightedChoice = function(array) {
  const target = Math.random() * weightSum(array);
  let runningValue = 0;
  let newValue;
  for (let i=0; i<array.length; i++) {
    if (array[i].values_.weight > 0) {
      newValue = runningValue + array[i].values_.weight;
      if (target <= newValue) return i;
      runningValue = newValue;
    }
  }
  return array.length - 1
};

const sampleWithReplacement = function(array, exclusives) {
  let choice = weightedChoice(array);
  while (exclusives.includes(array[choice])) {
    choice = weightedChoice(array);
  }
  return array[choice];
}


const sampleWithoutReplacement = function(array, n) {
  samples = new Array();
  sampleWithoutReplacement_(array, n-1);
}

const sampleWithoutReplacement_ = function(array, n) {
  let sampledIndex = weightedChoice(array);
  samples.push(array[sampledIndex]);
  array[sampledIndex].values_.weight = 0;
  if (n > 0) {
    sampleWithoutReplacement_(array, n-1);
  }
}

//================= Data stuff =================//
// Load street data
let largestStreetWeight;

const calculateStreetArray = function() {
  largestStreetWeight = 0;
  const boundaryExtent = boundaryFeature.getGeometry().getExtent();
  const t1 = transform([boundaryExtent[1], boundaryExtent[0]], 'EPSG:3857', 'EPSG:4326');
  const t2 = transform([boundaryExtent[3], boundaryExtent[2]], 'EPSG:3857', 'EPSG:4326');
  const boundaryDiagonal = getDistance(t1, t2) / 3;
  streetSource.getFeatures().forEach((feat, i) => {
    let streetLength = 0;
    let lStrings = feat.getGeometry().getLineStrings();
    for (var k=0; k < lStrings.length; k++) {
      streetLength += lStrings[k].getLength();
    }
    let streetWeight = 1;
    const selectedSamplingStrategy = document.querySelector('input[name="sampling-possibilities"]:checked');
    let streetPoint;
    if (selectedSamplingStrategy) {
      switch (selectedSamplingStrategy.value) {
        case 'streets-only':
          streetWeight = Math.min(streetLength, boundaryDiagonal);
          break;
        case 'streets-and-pin':
          streetPoint = feat.getGeometry().getClosestPoint(pinCoordinate);
          streetWeight = (Math.min(streetLength, boundaryDiagonal) + Math.max(boundaryDiagonal - getRealDistance(streetPoint, pinCoordinate), 0))/2; 
          break;
        case 'pin-only':
          streetPoint = feat.getGeometry().getClosestPoint(pinCoordinate);
          streetWeight = Math.max(boundaryDiagonal - getRealDistance(streetPoint, pinCoordinate), 0);
          break;
        case 'equal-chance':
          break;
        default:
          alert("Something went wrong. All streets have equal probability.")
          break;
      }
    }
    feat.values_.length = streetLength;
    feat.values_.weight = streetWeight;
    largestStreetWeight = (largestStreetWeight < streetWeight) ? streetWeight : largestStreetWeight;
  })
  /*

  // Sort streets by length in descending order
  streetArray.sort(function (a, b) {
    if (a.weight > b.weight) {
      return -1;
    } else if (a.weight < b.weight) {
      return 1;
    }
    return 0;
  });
  */
}

const loadStreets = function (streetsJSON) {
  const boundaryGeometry = boundaryFeature.getGeometry();
  streetsJSON.elements.forEach((street, s) => {
    const geometryCoordinates = new Array();
    let isInsideBoundary = false;
    for (let i=0; i < street.geometry.length; i++) {
      const point = fromLonLat([street.geometry[i].lon, street.geometry[i].lat]);
      geometryCoordinates.push(point);
      if (boundaryGeometry.intersectsCoordinate(point)) isInsideBoundary = true;
    }
    if (!isInsideBoundary) return;

    let feat = streetSource.getFeatureById(street.tags.name.toLowerCase());
    if (feat === null) {
      feat = new Feature({
        geometry: new MultiLineString([geometryCoordinates]),
        name: street.tags.name,
        kind: street.tags.highway
      })
      feat.setId(street.tags.name.toLowerCase())
      streetSource.addFeature(feat);
    } else {
      feat.getGeometry().appendLineString(new LineString(geometryCoordinates))
    }
  });
  streetDataHasBeenLoaded = true;

  setDifficulties(streetSource.getFeatures().length);
}

const clearStreets = function () {
  streetDataHasBeenLoaded = false;
  streetSource.clear();
}

//================= Map stuff =================//
// The area
let colormap = createColormap({
  colormap: 'RdBu',
  nshades: 10,
  format: 'hex',
  alpha: 1
})
let boundaryColor = "#5A02A7";
let boundaryWidth = 2;
/*
document.getElementById("boundaryWidth").value = boundaryWidth;
document.getElementById("boundaryWidthValue").innerHTML = boundaryWidth;
document.getElementById("boundaryColor").value = boundaryColor;
document.getElementById("boundaryColor").addEventListener("change", function (evt) {
  boundaryColor = evt.target.value;
  map.updateSize();
})
document.getElementById("boundaryWidth").addEventListener("change", function (evt) {
  boundaryWidth = evt.target.value;
  document.getElementById("boundaryWidthValue").innerHTML = evt.target.value;
  map.updateSize();
})
*/

const boundaryStyle = function () {
  return new Style({
    stroke: new Stroke({
      color: boundaryColor,
      width: boundaryWidth,
    })
  });
} 

const boundarySource = new VectorSource({
  wrapX: false,
  style: boundaryStyle,
});
const boundaryLayer = new VectorLayer({
  source: boundarySource,
});

// global so we can remove it later
let draw; 
let snap;
let modify;
let boundaryFeature;
let pin;
let pinFeature;
let pinCoordinate;
function addInteractions() {
  let value = typeSelect.value;
  if (value !== 'None') {
    if (value === 'Box') {
      draw = new Draw({
        source: boundarySource,
        type: 'Circle',
        geometryFunction: createBox(),
        condition: (e) => e.originalEvent.buttons === 1
      });
    } else {
      draw = new Draw({
        source: boundarySource,
        type: value,
        condition: (evt) => evt.originalEvent.buttons === 1
      });
    }
    draw.on('drawstart', function() {
      boundarySource.removeFeature(boundaryFeature);
      clearStreets();
    }, this);
    draw.on('drawend', function (evt) {
      evt.feature.setId("boundary");
      boundaryFeature = evt.feature;
    }, this);
    snap = new Snap({source: boundarySource});
    modify = new Modify({source: boundarySource});
    modify.on('modifyend', function () {
      clearStreets();
    });
    pin = new Draw({
      source: boundarySource,
      type: "Point",
      condition: (e) => e.originalEvent.buttons === 2
    });
    pin.on('drawstart', function(evt) {
      boundarySource.removeFeature(pinFeature);
    }, this);
    pin.on('drawend', function (evt) {
      pinFeature = evt.feature
      pinCoordinate = pinFeature.getGeometry().getCoordinates()
      pinFeature.setId("pin");
      pinFeature.setStyle(pinStyle);
    }, this);
    map.addInteraction(draw);
    map.addInteraction(modify);
    map.addInteraction(snap);
    map.addInteraction(pin);
  }
}

function removeInteractions() {
  map.removeInteraction(snap);
  map.removeInteraction(modify);
  map.removeInteraction(draw);
  map.removeInteraction(pin);
}


// The map
const center = fromLonLat([12.5610324, 55.7100802]);
const styleJson = "https://api.maptiler.com/maps/56feb159-fca4-4f18-981e-84c25f852b2d/style.json?key=56LOGfg1NE4izq9dmt6G"

const map = new Map({
  target: 'map',
  view: new View({
    constrainResolution: true,
    center: center,
    zoom: 13,
    minZoom: 1
  })
});
olms_apply(map, styleJson).then(function () {
  map.addLayer(boundaryLayer);
  boundaryFeature = new Feature({
    geometry: new Circle(center, 2000)
  });
  boundaryFeature.setId("boundary");
  boundarySource.addFeature(boundaryFeature)
  map.addLayer(streetLayer);
  map.addLayer(labelLayer);
});


// The street styles
let trueStreetColor = "#38B000";
let hoveredStreetColor = "#B32100";
let selectedStreetColor = "#fb8500";
let streetBorderOpacity = 30;
/*
document.getElementById("borderOpacityValue").innerHTML = streetBorderOpacity;
document.getElementById("borderOpacity").value = streetBorderOpacity;
document.getElementById("trueColor").value = trueStreetColor;
document.getElementById("trueColor").addEventListener("change", function (evt) {
  trueStreetColor = evt.target.value;
  map.updateSize();
})
document.getElementById("hoverColor").value = hoveredStreetColor;
document.getElementById("hoverColor").addEventListener("change", function (evt) {
  hoveredStreetColor = evt.target.value;
  map.updateSize();
})
document.getElementById("borderOpacity").addEventListener("change", function (evt) {
  streetBorderOpacity = Number(Math.round(evt.target.value * (255 / 100))).toString(16);
  document.getElementById("borderOpacityValue").innerHTML = evt.target.value;
  map.updateSize();
})
*/
streetBorderOpacity = Math.round(streetBorderOpacity * (255 / 100)).toString(16);

/*
const inactiveStreetStyle = function(feature, resolution) {
  const colorIndex = Math.round(9 * feature.values_.weight / largestStreetWeight);
  return new Style({
    stroke: new Stroke({ color: colormap[colorIndex], width: Math.max(2, 10/resolution) })
  })
}
*/

const inactiveStreetStyle = new Style({
  stroke: new Stroke({ color: "#00000000"})
})

const hoveredStreetStyle = function(feature, resolution) {
  return new Style({
    stroke: new Stroke({ color: hoveredStreetColor, width: Math.max(2, 10/resolution) })
  })
}

const incorrectStreetStyle = function(feature, resolution) {
  return [
    new Style({
      stroke: new Stroke({ color: hoveredStreetColor, width: Math.max(2, 10/resolution) }),
      zIndex: 2
    }),
    new Style({
      stroke: new Stroke({ color: `${hoveredStreetColor}${streetBorderOpacity}`, width: Math.max(40, 200/resolution) }),
      zIndex: 1
    })
  ]
};

const selectedStreetStyle = function(feature, resolution) {
  return [
    new Style({
      stroke: new Stroke({ color: selectedStreetColor, width: Math.max(2, 10/resolution) }),
      zIndex: 2
    }),
    new Style({
      stroke: new Stroke({ color: `${selectedStreetColor}${streetBorderOpacity}`, width: Math.max(40, 200/resolution) }),
      zIndex: 1
    })
  ]
};

const correctStreetStyle = function(feature, resolution) {
  return [
    new Style({
      stroke: new Stroke({ color: trueStreetColor, width: Math.max(2, 10/resolution) }),
      zIndex: 2
    }),
    new Style({
      stroke: new Stroke({ color: `${trueStreetColor}${streetBorderOpacity}`, width: Math.max(40, 200/resolution) }),
      zIndex: 1
    })
  ]
};

const correctGuessStyle = function(feature, resolution) {
  return new Style({
    stroke: new Stroke({ color: trueStreetColor, width: Math.max(2, 10/resolution) }),
    zIndex: 2
  })
};

const incorrectGuessStyle = function(feature, resolution) {
  return new Style({
    stroke: new Stroke({ color: hoveredStreetColor, width: Math.max(2, 10/resolution) }),
    zIndex: 2
  })
};

const errorStyle = function(feature, resolution) {
    return new Style({
      stroke: new Stroke({
        color: 'black',
        width: 2, // Math.max(2, 10/resolution),
        lineDash: [5, 10],
      }),
      zIndex: 2
    })
};

const distanceInfoStyle = function(distance) {
  return function (feature) {
    return new Style({
      image: new Icon({
        anchor: [0.5, 90],
        anchorXUnits: 'fraction',
        anchorYUnits: 'pixels',
        src: boxImageUrl,
        scale: 0.5
      }),
      text: new Text({
        textAlign: 'center',
        text: distance,
        fill: new Fill({color: "black"}),
        stroke: new Stroke({color: "black"}),
        font: "bold 20px Arial, Verdana, Courier New",
        offsetY: -50*0.5,
        scale: 0.5
      }),
      zIndex: feature.zIndex+5
    });
  };
};

const selectSummaryInfoStyle = function(distance, name) {
  return function (feature) {
    return [
      new Style({
        image: new Icon({
          anchor: [0.5, 90],
          anchorXUnits: 'fraction',
          anchorYUnits: 'pixels',
          src: boxImageUrl,
          scale: [Math.max(name.length/12, 0.5), 0.6]
        }),
        text: new Text({
          textAlign: 'center',
          text: distance,
          fill: new Fill({color: "black"}),
          stroke: new Stroke({color: "black"}),
          font: "bold 20px Arial, Verdana, Courier New",
          offsetY: -50*0.78,
          scale: 0.7
        }),
        zIndex: feature.zIndex+5
      }),
      new Style({
        text: new Text({
          textAlign: 'center',
          text: name,
          fill: new Fill({color: "black"}),
          stroke: new Stroke({color: "black"}),
          font: "bold 20px Arial, Verdana, Courier New",
          offsetY: -50*0.48,
          scale: 0.7
        }),
        zIndex: feature.zIndex+5
      }),
    ]
  };
};

const pinStyle = new Style({
  image: new Icon({
    anchor: [0.5, 512],
    anchorXUnits: 'fraction',
    anchorYUnits: 'pixels',
    src: pinImageUrl,
    scale: 0.05
  })
});

const streetSource = new VectorSource({wrapX: false});
const streetLayer = new VectorLayer({
  source: streetSource,
  style: inactiveStreetStyle
});

const labelSource = new VectorSource({wrapX: false});
const labelLayer = new VectorLayer({
  source: labelSource,
  style: undefined
});

const getClosesFeatureWithinDistance = function(coordinate, dist) {
  const closestFeature = streetSource.getClosestFeatureToCoordinate(coordinate);
  const pt = closestFeature.getClosestPoint(coordinate);
  if (getRealDistance(coordinate, pt) < dist) {
    return closestFeature;
  }
  return null;
};


let hoveredFeature = null;
let selectedFeature = null;
let trueFeature = null;
let errorLine = null;
let distanceInfoBox = null;
let streetDataHasBeenLoaded = false;
map.on('pointermove', function (evt) {
  if (!isSearching) return;
  if (hoveredFeature !== null) {
    hoveredFeature.setStyle(undefined);
    hoveredFeature = null;
  }
  hoveredFeature = getClosesFeatureWithinDistance(evt.coordinate, 50);
  if (hoveredFeature === selectedFeature) {
    hoveredFeature = null;
    return;
  }
  if (hoveredFeature) {
    hoveredFeature.setStyle(hoveredStreetStyle)
    //document.getElementById("debug").innerHTML = hoveredFeature.values_.kind // UNCOMMENT TO DEBUG SOMETHING ABOUT STREETS
  }
});

map.getViewport().addEventListener('mouseout', function () {
  if (hoveredFeature !== null) {
    hoveredFeature.setStyle(undefined);
    hoveredFeature = null;
  }
});

map.addEventListener("click", function () {
  if (!isSearching) return;
  if (hoveredFeature !== null) {
    selectedFeature = hoveredFeature;
    selectedFeature.setStyle(selectedStreetStyle)
    hoveredFeature = null;
  } else {
    selectedFeature = getClosesFeatureWithinDistance(evt.coordinate, 50);
  }
  if (selectedFeature !== null) {
    selectedFeature.setStyle(undefined);
  }
  
})

//================= Menu stuff =================//
// Load all static images
document.getElementById("home-section").style.backgroundImage = `url(${getImageUrl("city_rug", "jpg")})`;
document.getElementById("home-section").style.backgroundPosition = "center";
document.querySelectorAll(".icon-button").forEach(function (element) {
  element.src = getImageUrl(element.id, "png");
})
document.getElementById("github").src = getImageUrl("github", "png");
document.getElementById("linkedin").src = getImageUrl("linkedin", "png");

// Main Navigation Bar
const changeMainSection = function(evt) {
  let element = evt.currentTarget;
  if (element.classList.contains("main-active")) return;
  const sidebar = document.getElementById("sidebar")
  const mapDiv = document.getElementById("map")

  // Remove/Add interactions if boundary section
  if (element.id === "boundary") {
    addInteractions();
    if (boundaryFeature !== undefined) boundaryFeature.setStyle(undefined);
  } else {
    removeInteractions();
    if (boundaryFeature !== undefined) boundaryFeature.setStyle(boundaryStyle);
  }

  // Stop initialising game
  cancelGameStart();

  // Display correct section
  if (element.id === "home") {
    sidebar.style.display = "none";
    mapDiv.style.visibility = "hidden";
  } else {
    sidebar.style.display = "block";
    mapDiv.style.visibility = "visible";
    document.getElementById("home-section").style.display = "none";
  }
  const mainNavigationItems = document.getElementById("main-navigation-bar-section-items").children;
  for (var i=0; i < mainNavigationItems.length; i++) {
    if (mainNavigationItems[i].classList.contains("main-active")) {
      mainNavigationItems[i].classList.remove("main-active");
      document.getElementById(`${mainNavigationItems[i].id}-section`).style.display = "none";
    }
  };
  let activeSection = document.getElementById(`${element.id}-section`);
  element.classList.add("main-active")
  activeSection.style.display = "block";
}
const mainNavBarItems = document.getElementById("main-navigation-bar-section-items").childNodes;
for (let i=0; i < mainNavBarItems.length; i++) {
  mainNavBarItems[i].addEventListener("click", changeMainSection);
}

//================= Game page stuff =================//
// START GAME
let gameMode = null;
let gameContainerId = null;
let zoomSpeed = 100;

const gameStep = function () {
  zoomToExtent(boundaryFeature.getGeometry().getExtent(), zoomSpeed);
  if (gameHasEnd) {
    sampledStreet.innerHTML = samples[currentIteration-1].values_.name;
  } else {
    const choice = sampleWithReplacement(streetSource.getFeatures(), lastFiveStreets);
    sampledStreet.innerHTML = choice.values_.name;
    lastFiveStreets.push(choice);
    if (lastFiveStreets.length > 5) lastFiveStreets.shift();
  }
  currentIterationElement.innerHTML = currentIteration;
  currentIteration += (gameHasEnd) ? -1 : 1;
  isSearching = true;
}

const goToNextStreet = function () {
  // Reset graphics
  if (trueFeature !== null) {
    trueFeature.setStyle(undefined);
    trueFeature = null;
  }
  if (selectedFeature !== null) {
    selectedFeature.setStyle(undefined);
    selectedFeature = null;
  }
  labelSource.clear()
}

const evaluteGuess = function () {
  let realErrorDistance = 0;
  if (sampledStreet.innerHTML === selectedFeature.values_.name) {
    if (!gameHasEnd) {
      selectedFeature.values_.weight *= 0.75;
    }
    correct += 1;
    correctElement.innerHTML = correct;
    // Display success information
    selectedFeature.setStyle(correctStreetStyle);
    const trueExtent = selectedFeature.getGeometry().getExtent();
    zoomToExtent(trueExtent, zoomSpeed);
  } else {
    if (!gameHasEnd) {
      selectedFeature.values_.weight *= 1.5;
    }
    incorrect += 1;
    incorrectElement.innerHTML = incorrect;
    // Display error information
    selectedFeature.setStyle(incorrectStreetStyle);
    const selectedCenterCoord = getCenterOfStreet(selectedFeature);
    trueFeature = streetSource.getFeatureById(sampledStreet.innerHTML.toLowerCase());
    trueFeature.setStyle(correctStreetStyle);
    const trueCenterCoord = getCenterOfStreet(trueFeature);
    errorLine = new Feature({
      geometry: new LineString([selectedCenterCoord, trueCenterCoord]),
    });
    const errorLineCenterCoord = selectedCenterCoord.map(function (value, idx) {
      return (value + trueCenterCoord[idx])/2;
    });
    distanceInfoBox = new Feature({
      geometry: new Point(errorLineCenterCoord)
    });
    labelSource.addFeatures([errorLine, distanceInfoBox]);
    errorLine.setStyle(errorStyle);
    realErrorDistance = getRealLineDistance(errorLine.getGeometry());
    distanceInfoBox.setStyle(distanceInfoStyle(formatLength(realErrorDistance)));
    // Update error distance
    accumulatedDistance += realErrorDistance;
    accumulatedDistanceElement.innerHTML = formatLength(accumulatedDistance);
    // Zoom to street extend
    const guessedExtent = selectedFeature.getGeometry().getExtent();
    const trueExtent = trueFeature.getGeometry().getExtent();
    const fitExtent = [
      Math.min(guessedExtent[0], trueExtent[0]),
      Math.min(guessedExtent[1], trueExtent[1]),
      Math.max(guessedExtent[2], trueExtent[2]),
      Math.max(guessedExtent[3], trueExtent[3]),
    ]
    zoomToExtent(fitExtent, zoomSpeed);
  };
  guesses.push({
    name: sampledStreet.innerHTML,
    distance: realErrorDistance,
    isCorrect: sampledStreet.innerHTML === selectedFeature.values_.name
  })
};

const preGameLoad = function(evt) {
  if (boundarySource.getFeatures().length === 0) return;
  let button = evt.target;
  if (!streetDataHasBeenLoaded) {
    streetSource.clear();
    fetchData();
  }
  gameMode = button.id.split("-")[1];
  document.getElementById("game-length-form").style.display = "block";
  button.disabled = true;
}
document.getElementById("play-select").addEventListener("click", preGameLoad);
// document.getElementById("play-name").addEventListener("click", preGameLoad);  //Uncomment when implemented
// document.getElementById("play-mark").addEventListener("click", preGameLoad);  //Uncomment when implemented

let summaryFeatures;
const gameSummary = function () {
  document.getElementById(gameContainerId).style.display = "none";
  document.getElementById('summary').style.display = "block";
  document.getElementById("summary-correct").innerHTML = correct;
  document.getElementById("summary-incorrect").innerHTML = incorrect;
  document.getElementById("summary-distance").innerHTML = formatLength(accumulatedDistance);
  summaryFeatures = new Array();
  // Draw street guesses
  for (let i=0; i<guesses.length; i++) {
    const {name, distance, isCorrect} = guesses[i];
    let street = streetSource.getFeatureById(name.toLowerCase());
    street.setStyle((isCorrect) ? correctGuessStyle : incorrectGuessStyle);
    const streetCenterCoord = getCenterOfStreet(street);
    distanceInfoBox = new Feature({
      geometry: new Point(streetCenterCoord)
    });
    distanceInfoBox.setStyle(selectSummaryInfoStyle(formatLength(distance), name));
    summaryFeatures.push(distanceInfoBox);
    zoomToExtent(boundaryFeature.getGeometry().getExtent(), zoomSpeed);
  };
  summaryFeatures.sort(function (a, b) {
    const aSize = a.getGeometry().getCoordinates()[1];
    const bSize = b.getGeometry().getCoordinates()[1];
    if (aSize > bSize) {
      return -1;
    } else if (aSize < bSize) {
      return 1;
    }
    return 0;
  });
  for (let i=0; i<summaryFeatures.length; i++) {
    summaryFeatures[i].zIndex = i+10;
    labelSource.addFeature(summaryFeatures[i]);
  }
};

const summaryComplete = function() {
  document.getElementById("summary").style.display = "none";
  gameHasEnd = null;
  labelSource.clear();
  guesses.forEach(function(element) {
    streetSource.getFeatureById(element.name.toLowerCase()).setStyle(undefined);
  })
}

const summaryRestart = function() {
  summaryComplete();
  initialiseGame();
};
document.getElementById("summary-restart").addEventListener("click", summaryRestart);

const summaryEnd = function() {
  summaryComplete();
  document.getElementById("sidebar").style.display = "block";
  document.getElementById("main-navigation-bar").style.display = "block";
  if (pinFeature) {
    boundarySource.addFeature(pinFeature);
  }
};
document.getElementById("summary-end").addEventListener("click", summaryEnd);

let currentIteration;
let currentIterationElement;
let correct;
let correctElement;
let incorrect;
let incorrectElement;
let accumulatedDistance;
let accumulatedDistanceElement;
let guesses;
let samples;
let sampledStreet;
let gameHasEnd;
let lastFiveStreets;
const initialiseGame = function () {
  // Change website to game mode
  document.getElementById("main-navigation-bar").style.display = "none";
  document.getElementById("sidebar").style.display = "none";
  document.getElementById("game-length-form").style.display = "none";
  gameContainerId = `game-${gameMode}`;
  document.getElementById(gameContainerId).style.display = "block";
  document.getElementById(`play-${gameMode}`).disabled = false;
  // Initialise game variables
  currentIterationElement = document.getElementById(`${gameMode}-iter`);
  correctElement = document.getElementById(`${gameMode}-correct`);
  incorrectElement = document.getElementById(`${gameMode}-incorrect`);
  accumulatedDistanceElement = document.getElementById(`${gameMode}-distance`);
  sampledStreet = document.getElementById(`${gameMode}-street`);
  // Update interface
  gameHasEnd = gameLengths[gameLengthSlider.value] !== "Free play";
  currentIteration = (gameHasEnd) ? gameLengths[gameLengthSlider.value] : 1;
  currentIterationElement.innerHTML = currentIteration;
  correct = 0;
  correctElement.innerHTML = correct;
  incorrect = 0;
  incorrectElement.innerHTML = incorrect;
  accumulatedDistance = 0;
  accumulatedDistanceElement.innerHTML = accumulatedDistance;
  guesses = new Array();
  boundarySource.removeFeature(pinFeature);
  // Sample streets
  calculateStreetArray();
  if (!gameHasEnd) {
    lastFiveStreets = new Array();
  } else {
    sampleWithoutReplacement(streetSource.getFeatures(), gameLengths[gameLengthSlider.value]);
    shuffle(samples);
  }
  // Start game
  gameStep();
}
document.getElementById("begin-game").addEventListener("click", initialiseGame);

const confirmGuess = function (evt) {
  if (selectedFeature === null) return;
  let button = evt.target;
  if (isSearching) {
    button.innerHTML = ">>";
    evaluteGuess();
    isSearching = false;
  } else {
    button.innerHTML = "Confirm";
    goToNextStreet();
    if (currentIteration > 0) {
      gameStep();
    } else {
      gameSummary();
    }
  };
};
document.getElementById("select-confirm").addEventListener("click", confirmGuess);
const forceEndGame = function () {
  isSearching = false;
  goToNextStreet();
  gameSummary();
}
document.getElementById("select-end").addEventListener("click", forceEndGame);

// Difficulty
let gameLengths;
const gameLengthLevel = document.getElementById("game-length-text");
const gameLengthSlider = document.getElementById("game-length-slider");
const setDifficulties = function (streetCount) {
  let gameLength = 5;
  gameLengths = new Array();
  while (gameLength < streetCount) {
    gameLengths.push(gameLength);
    gameLength *= 2;
  }
  gameLengths.push(streetCount);
  gameLengths.push("Free play"); // Free play
  if (gameLengthSlider.value > gameLengths.length - 1) {
    gameLengthSlider.value = 0;
  }
  gameLengthSlider.max = gameLengths.length - 1;
  gameLengthLevel.innerHTML = gameLengths[gameLengthSlider.value];
}
gameLengthSlider.addEventListener('input', function (e) {
  gameLengthLevel.innerHTML = gameLengths[e.target.value];
})

const cancelGameStart = function () {
  if (gameMode === null) return;
  document.getElementById("game-length-form").style.display = "none";
  document.getElementById(`play-${gameMode}`).disabled = false;
  gameMode = null;
};
document.getElementById("close").addEventListener("click", cancelGameStart);

// Address Bar
let isSearching = false;
const bodyStyle = getComputedStyle(document.getElementsByTagName("body")[0])
const correctColor = bodyStyle.getPropertyValue("--correct-color");
const incorrectColor = bodyStyle.getPropertyValue("--incorrect-color");


//================= Boundary stuff =================//
const typeSelect = document.getElementById('shape-type');
typeSelect.onchange = function () {
  removeInteractions();
  addInteractions();
};

document.getElementById('undo').addEventListener('click', function () {
  draw.removeLastPoint();
});
document.getElementById('remove-pin').addEventListener('click', function () {
  boundarySource.removeFeature(pinFeature);
});

const fetchData = async function () {
  let bbox = boundaryFeature.getGeometry().getExtent();
  bbox = transformExtent(bbox, 'EPSG:3857', 'EPSG:4326');
  fetch(
    "https://overpass-api.de/api/interpreter",
    {
        method: "POST",
        // The body contains the query
        body: "data="+ encodeURIComponent(`
            [out:json]
            [timeout:90]
            ;
            (
                way[highway][name]
                    (
                         ${bbox[1]},
                         ${bbox[0]},
                         ${bbox[3]},
                         ${bbox[2]}
                     );
            );
            out geom;
        `)
    },
  ).then(
      (data)=>data.json()
  ).then(
    (result) => loadStreets(result)
  )
};
