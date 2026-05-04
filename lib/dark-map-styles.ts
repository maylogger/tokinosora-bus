/**
 * 深色模式底圖：與 clean-map-styles（淺色）同結構的冷色藍調。
 * 對比刻意壓低：陸／路／水色相接近、僅微調明度，視覺較柔。
 */

export const darkMapStyles: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1f2733" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8a9bab" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a2129" }] },
  {
    featureType: "administrative",
    elementType: "geometry",
    stylers: [{ color: "#232b36" }],
  },
  {
    featureType: "administrative.land_parcel",
    elementType: "labels.text.fill",
    stylers: [{ color: "#6f7f8f" }],
  },
  {
    featureType: "landscape",
    elementType: "geometry",
    stylers: [{ color: "#1e262f" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#242d38" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#7b8c9a" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#252f38" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#748998" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#2d3845" }],
  },
  {
    featureType: "road.arterial",
    elementType: "geometry",
    stylers: [{ color: "#313c4a" }],
  },
  {
    featureType: "road.arterial",
    elementType: "labels.text.fill",
    stylers: [{ color: "#9aaab6" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#374350" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#a8b6c2" }],
  },
  {
    featureType: "road.local",
    elementType: "labels.text.fill",
    stylers: [{ color: "#8b9aa6" }],
  },
  {
    featureType: "transit.line",
    elementType: "geometry",
    stylers: [{ color: "#2b343f" }],
  },
  {
    featureType: "transit.station",
    elementType: "geometry",
    stylers: [{ color: "#29323c" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#2e3d4a" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#8e9eab" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#252e38" }],
  },
]
