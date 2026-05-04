/**
 * 藍色漸層感底圖：淺藍灰陸域／道路過渡到較飽和的水域藍，
 * POI 與標籤亦維持冷色調以利路線叠上閱讀。
 */

export const cleanMapStyles: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#e4eef8" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#4a6888" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#eef5fc" }] },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ color: "#dcebf7" }],
  },
  {
    featureType: "administrative.land_parcel",
    elementType: "labels.text.fill",
    stylers: [{ color: "#7598b8" }],
  },
  {
    featureType: "landscape",
    elementType: "geometry",
    stylers: [{ color: "#dfeaf5" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#d3e6f4" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#5f7ea0" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#c9dff0" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#5c7896" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#f5f9fd" }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: "#e8f1fa" }],
  },
  {
    featureType: "road.arterial",
    elementType: "labels.text.fill",
    stylers: [{ color: "#5a7394" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#dae9f8" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#4a6888" }],
  },
  {
    featureType: "road.local",
    elementType: "labels.text.fill",
    stylers: [{ color: "#6f8aad" }],
  },
  {
    featureType: "transit.line",
    elementType: "geometry",
    stylers: [{ color: "#c8dcf0" }],
  },
  {
    featureType: "transit.station",
    elementType: "geometry",
    stylers: [{ color: "#cfe2f5" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    // 接近原生 Google Maps 的淺水藍，不致與陸域對比過強
    stylers: [{ color: "#a4dafa" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#5a82a8" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#d4eefc" }],
  },
]
