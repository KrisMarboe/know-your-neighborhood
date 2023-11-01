import './style.css';
import imageUrl from './distanceInfoBox.png'
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

// ================ Utility stuff =================//
const getCenterOfStreet = function (streetFeature) {
  const streetGeometry = streetFeature.getGeometry();
  return streetGeometry.getClosestPoint(getCenter(streetGeometry.getExtent()));
}

const getRealDistance = function (line) {
  const coordinates = line.getCoordinates();

  var dist = 0;
  //loop through all coordinates
  for(var i = 0; i < coordinates.length -1; i++) {
    let t1 = transform(coordinates[i], 'EPSG:3857', 'EPSG:4326');
    let t2 = transform(coordinates[i+1], 'EPSG:3857', 'EPSG:4326');
    // get distance on sphere
    dist += getDistance(t1, t2);
  }
  // get distance on sphere
  return formatLength(dist);
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

//================= Data stuff =================//
// Load street data
let streetsByLength = new Array();

const loadStreets = function (streetsJSON) {
  const boundaryGeometry = boundarySource.getFeatureById("boundary").getGeometry();
  streetsByLength = new Array();
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

  })

  // DO STUFF HERE
  streetSource.getFeatures().forEach((feat, i) => {
    let streetLength = 0;
    let lStrings = feat.getGeometry().getLineStrings();
    for (var k=0; k < lStrings.length; k++) {
      streetLength += lStrings[k].getLength();
    }
    streetsByLength.push({"name": feat.values_.name, "length": streetLength})
  })

  setDifficulties(streetsByLength.length);

  // Sort streets by length in descending order
  streetsByLength.sort(function (a, b) {
    if (a.length > b.length) {
      return -1;
    } else if (a.length < b.length) {
      return 1;
    }
    return 0;
  });
}

const clearStreets = function () {
  streetSource.clear();
  map.removeLayer(streetLayer);
}

//================= Map stuff =================//
// The area
let boundaryColor = "#5A02A7";
let boundaryWidth = 2;
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

let draw; // global so we can remove it later
let snap; // global so we can remove it later
let modify; // global so we can remove it later
function addInteractions() {
  let value = typeSelect.value;
  if (value !== 'None') {
    if (value === 'Box') {
      draw = new Draw({
        source: boundarySource,
        type: 'Circle',
        geometryFunction: createBox(),
      });
    } else {
      draw = new Draw({
        source: boundarySource,
        type: value,
      });
    }
    draw.on('drawstart', function() {
      boundarySource.clear();
    }, this);
    draw.on('drawend', function(evt) {
      evt.feature.setId("boundary");
      evt.feature.setStyle(boundaryStyle);
    }, this);
    snap = new Snap({source: boundarySource});
    modify = new Modify({source: boundarySource});
    map.addInteraction(draw);
    map.addInteraction(modify);
    map.addInteraction(snap);
  }
}

function removeInteractions() {
  map.removeInteraction(snap);
  map.removeInteraction(modify);
  map.removeInteraction(draw);
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
olms_apply(map, styleJson).then(function () {map.addLayer(boundaryLayer);});


// The street styles
let trueStreetColor = "#38B000";
let hoveredStreetColor = "#B32100";
let streetBorderOpacity = 30;
document.getElementById("borderOpacityValue").innerHTML = streetBorderOpacity;
document.getElementById("borderOpacity").value = streetBorderOpacity;
streetBorderOpacity = Math.round(streetBorderOpacity * (255 / 100)).toString(16);
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


const inactiveStreetStyle = [
  new Style({
    stroke: new Stroke({ color: 'rgba(255, 255, 255, 0)', width: 1 })
  }),
  new Style({
    stroke: new Stroke({ color: 'rgba(255, 255, 255, 0)', width: 1 })
  }),
]

const hoveredStreetStyle = function(feature, resolution) {
  return new Style({
    stroke: new Stroke({ color: hoveredStreetColor, width: Math.max(2, 10/resolution) })
  })
}

const guessedStreetStyle = function(feature, resolution) {
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

const trueStreetStyle = function(feature, resolution) {
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
  return new Style({
     image: new Icon({
      anchor: [0.5, 90],
      anchorXUnits: 'fraction',
      anchorYUnits: 'pixels',
      src: imageUrl,
      scale: 0.7
    }),
    text: new Text({
      textAlign: 'center',
      text: distance,
      fill: new Fill({color: "black"}),
      stroke: new Stroke({color: "black"}),
      font: "bold 20px Arial, Verdana, Courier New",
      offsetY: -50*0.7,
      scale: 0.7
    }),
    zIndex: 3
  });
}

const streetSource = new VectorSource({wrapX: false});
const streetLayer = new VectorLayer({
  source: streetSource,
  style: inactiveStreetStyle
});

let hoveredFeature = null;
let selectedFeature = null;
let errorLine = null;
let distanceInfoBox = null;
map.on('pointermove', function (e) {
  if (!isSearching) return; 
  if (hoveredFeature !== null) {
    hoveredFeature.setStyle(undefined);
    hoveredFeature = null;
  }
  hoveredFeature = streetSource.getClosestFeatureToCoordinate(e.coordinate);
  if (hoveredFeature) {
    hoveredFeature.setStyle(hoveredStreetStyle)
    document.getElementById("debug").innerHTML = hoveredFeature.values_.kind // UNCOMMENT TO DEBUG SOMETHING ABOUT STREETS
  }
});

map.getViewport().addEventListener('mouseout', function (e) {
  if (hoveredFeature !== null) {
    hoveredFeature.setStyle(undefined);
    hoveredFeature = null;
  }
});

map.addEventListener("click", function (e) {
  if (!isSearching) return;
  if (hoveredFeature === null) return;
  selectedFeature = hoveredFeature;
  hoveredFeature = null;
  isSearching = false;
  generateButton.disabled = false;
  guessedStreet = selectedFeature.values_.name
  selectedFeature.setStyle(guessedStreetStyle)
  const trueFeature = streetSource.getFeatureById(trueStreet.toLowerCase());
  trueFeature.setStyle(trueStreetStyle);
  guessedAddress.innerHTML = guessedStreet
  let borderColor;
  if (guessedAddress.innerHTML === trueAddress.innerHTML) {
    borderColor = correctColor;
  } else {
    borderColor = incorrectColor;
    const selectedCenterCoord = getCenterOfStreet(selectedFeature);
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
    streetSource.addFeatures([errorLine, distanceInfoBox]);
    errorLine.setStyle(errorStyle);
    distanceInfoBox.setStyle(distanceInfoStyle(getRealDistance(errorLine.getGeometry())));
    const guessedExtent = selectedFeature.getGeometry().getExtent();
    const trueExtent = trueFeature.getGeometry().getExtent();
    const fitExtent = [
      Math.min(guessedExtent[0], trueExtent[0]),
      Math.min(guessedExtent[1], trueExtent[1]),
      Math.max(guessedExtent[2], trueExtent[2]),
      Math.max(guessedExtent[3], trueExtent[3]),
    ]
    map.getView().fit(fitExtent, { duration: 500 });
  }
  guessedAddress.style.border = `0.2rem solid ${borderColor}`;
})


//================= Game stuff =================//
// Game functions
const initialiseGame = function() {
  fetchData();
  map.addLayer(streetLayer);
}

const endGame = function() {
  resetGame();
  clearStreets();
}

const resetGame = function() {
  hoveredFeature = null;
  selectedFeature = null;
  isSearching = false;
  if (trueStreet !== null)
    streetSource.getFeatureById(trueStreet.toLowerCase()).setStyle(undefined);
  trueStreet = null;
  trueAddress.innerHTML = "_";
  if (guessedStreet !== null)
    streetSource.getFeatureById(guessedStreet.toLowerCase()).setStyle(undefined);
  guessedStreet = null;
  guessedAddress.innerHTML = "_";
  guessedAddress.style.borderWidth = 0;
  generateButton.disabled = false;
}




//================= Menu stuff =================//
// Navigation Bar
const changeMenu = function (evt) {
  let element = evt.currentTarget;
  if (element.classList.contains("active")) return;
  let childElements = element.parentNode.children;
  for (var i=0; i < childElements.length; i++) {
    if (childElements[i].classList.contains("active")) {
      childElements[i].classList.remove("active");
      document.getElementById(childElements[i].innerHTML.toLowerCase()).style.display = "none";
    }
  };
  element.classList.add("active");
  document.getElementById(element.innerHTML.toLowerCase()).style.display = "block";
}
const navBarItems = document.getElementById("navBar").childNodes;
for (let i=0; i < navBarItems.length; i++) {
  navBarItems[i].addEventListener("click", changeMenu);
}
const navBarShapeItems = document.getElementById("navBarShape").childNodes;
for (let i=0; i < navBarShapeItems.length; i++) {
  navBarShapeItems[i].addEventListener("click", changeMenu);
}

//================= Game page stuff =================//
// START GAME
let isPlaying = false;
const PlayGame = function(evt) {
  if (boundarySource.getFeatures().length === 0) return;
  let button = evt.target;
  button.classList.remove(isPlaying ? "gameEnd" : "gameBegin");
  button.classList.add(isPlaying ? "gameBegin" : "gameEnd");
  document.getElementById("playDiv").style.display = isPlaying ? "none" : "block";
  document.getElementById("boundaryDiv").style.display = isPlaying ? "block" : "none";
  button.innerHTML = isPlaying ? "Play" : "End";
  if (!isPlaying) {
    initialiseGame();
    removeInteractions();
  } else {
    endGame();
    addInteractions();
  }
  isPlaying = !isPlaying;
}
document.getElementById("play").addEventListener("click", PlayGame);

// Difficulty
let difficulties;
const difficultyLevel = document.getElementById("difficultyText");
const difficultySlider = document.getElementById("difficultySlider");
const setDifficulties = function (streetCount) {
  let difficulty = 5;
  difficulties = new Array();
  while (difficulty < streetCount) {
    difficulties.push(difficulty);
    difficulty *= 2;
  }
  difficulties.push(streetCount);
  if (difficultySlider.value > difficulties.length - 1) {
    difficultySlider.value = 0;
  }
  difficultySlider.max = difficulties.length - 1;
  difficultyLevel.innerHTML = difficulties[difficultySlider.value];
}
difficultySlider.addEventListener('input', function (e) {
  difficultyLevel.innerHTML = difficulties[e.target.value];
})

// Address Bar
let trueAddress = document.getElementById("trueAddress");
let guessedAddress = document.getElementById("guessedAddress");
let isSearching = false;
let trueStreet = null;
let guessedStreet = null;
const bodyStyle = getComputedStyle(document.getElementsByTagName("body")[0])
const correctColor = bodyStyle.getPropertyValue("--correct-color");
const incorrectColor = bodyStyle.getPropertyValue("--incorrect-color");

// Generate Button
let generateButton = document.getElementById("generate");
generateButton.addEventListener('click', () => {
  if (trueStreet !== null) {
    streetSource.getFeatureById(trueStreet.toLowerCase()).setStyle(undefined);
  }
  if (selectedFeature !== null) {
    selectedFeature.setStyle(undefined);
  }
  if (errorLine !== null) {
    streetSource.removeFeature(errorLine);
  }
  if (distanceInfoBox !== null) {
    streetSource.removeFeature(distanceInfoBox);
  }
  generateButton.disabled = true;
  isSearching = true;
  trueStreet = streetsByLength[Math.floor(Math.random() * difficultyLevel.innerHTML)].name;
  trueAddress.innerHTML = trueStreet;
  guessedAddress.innerHTML = '_';
  guessedAddress.style.borderWidth = 0;
  map.getView().fit(boundarySource.getFeatures()[0].getGeometry().getExtent(), { duration: 200 });
});


//================= Boundary stuff =================//
const typeSelect = document.getElementById('shapeType');
typeSelect.onchange = function () {
  map.removeInteraction(snap);
  map.removeInteraction(modify);
  map.removeInteraction(draw);
  addInteractions();
};

document.getElementById('undo').addEventListener('click', function () {
  draw.removeLastPoint();
});

const fetchData = async function () {
  let bbox = boundarySource.getFeatureById("boundary").getGeometry().getExtent();
  bbox = transformExtent(bbox, 'EPSG:3857', 'EPSG:4326');
  var result = await fetch(
    "https://overpass-api.de/api/interpreter",
    {
        method: "POST",
        // The body contains the query
        // to understand the query language see "The Programmatic Query Language" on
        // https://wiki.openstreetmap.org/wiki/Overpass_API#The_Programmatic_Query_Language_(OverpassQL)
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
  )
  loadStreets(result);
};

// document.getElementById('save').addEventListener('click', fetchData)

addInteractions();