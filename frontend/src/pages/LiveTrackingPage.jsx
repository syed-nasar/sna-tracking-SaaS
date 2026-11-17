
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  CircleAlert,
  Clock3,
  Crosshair,
  Layers,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Search,
  Truck,
  Users,
} from "lucide-react";

import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";

import "leaflet/dist/leaflet.css";

import { useAuth } from "../context/AuthContext";
import TenantLayout from "../components/TenantLayout";
import { tenantApi } from "../services/api";

const DEFAULT_CENTER = [24.8607, 67.0011];
const REFRESH_INTERVAL = 15000;

const STREET_TILES =
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const SATELLITE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

function validCoordinates(position) {
  return (
    position &&
    typeof position.latitude === "number" &&
    typeof position.longitude === "number" &&
    Number.isFinite(position.latitude) &&
    Number.isFinite(position.longitude) &&
    Math.abs(position.latitude) <= 90 &&
    Math.abs(position.longitude) <= 180
  );
}

function formatTime(value) {
  if (!value) return "Not available";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleString();
}

function formatSpeed(position) {
  if (typeof position?.speed !== "number") {
    return "—";
  }

  // Traccar reports speed in knots.
  return `${(position.speed * 1.852).toFixed(1)} km/h`;
}

function getVehicleName(vehicle) {
  return vehicle.name || `Vehicle ${vehicle.id}`;
}

function getVehicleModel(vehicle) {
  return (
    [vehicle.make, vehicle.model]
      .filter(Boolean)
      .join(" ") || "Model not specified"
  );
}

/*
 * Shared authenticated image component.
 *
 * Vehicle images require an Authorization Bearer token.
 * Images are downloaded through tenantApi and converted
 * to temporary browser object URLs.
 *
 * Image loading depends on the image URL, not GPS data,
 * so position refreshes do not repeatedly download
 * unchanged vehicle images.
 */
function VehicleImage({
  vehicleId,
  imageUrl,
  className = "",
  iconSize = 22,
  alt = "Vehicle image",
}) {
  const [imageState, setImageState] = useState({
    key: null,
    source: null,
  });

  const imageKey = imageUrl
    ? `${vehicleId}:${imageUrl}`
    : null;

  useEffect(() => {
    if (!imageKey) {
      return undefined;
    }

    let cancelled = false;
    let objectUrl = null;

    async function loadImage() {
      try {
        const response = await tenantApi.get(
          `/vehicles/${vehicleId}/image`,
          {
            responseType: "blob",
          }
        );

        if (cancelled) return;

        objectUrl = URL.createObjectURL(response.data);

        setImageState({
          key: imageKey,
          source: objectUrl,
        });
      } catch (error) {
        if (!cancelled) {
          console.error(
            `Unable to load image for vehicle ${vehicleId}:`,
            error.message
          );

          setImageState({
            key: imageKey,
            source: null,
          });
        }
      }
    }

    loadImage();

    return () => {
      cancelled = true;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [vehicleId, imageUrl, imageKey]);

  const source =
    imageState.key === imageKey
      ? imageState.source
      : null;

  if (!source) {
    return (
      <div
        className={`flex items-center justify-center bg-blue-500/10 text-blue-400 ${className}`}
      >
        <Truck size={iconSize} />
      </div>
    );
  }

  return (
    <img
      src={source}
      alt={alt}
      className={`object-cover ${className}`}
    />
  );
}

function GpsStatusBadge({ status }) {
  const normalized = String(
    status || "unknown"
  ).toLowerCase();

  const style =
    normalized === "online"
      ? "bg-emerald-500/10 text-emerald-400"
      : normalized === "offline"
        ? "bg-amber-500/10 text-amber-400"
        : "bg-slate-500/10 text-slate-400";

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold capitalize ${style}`}
    >
      {normalized}
    </span>
  );
}

function fitVehicleBounds(map, locatedVehicles) {
  if (locatedVehicles.length === 0) {
    return;
  }

  if (locatedVehicles.length === 1) {
    const position = locatedVehicles[0].position;

    map.flyTo(
      [position.latitude, position.longitude],
      15,
      { duration: 0.8 }
    );

    return;
  }

  const bounds = locatedVehicles.map(
    (vehicle) => [
      vehicle.position.latitude,
      vehicle.position.longitude,
    ]
  );

  map.flyToBounds(bounds, {
    padding: [60, 60],
    maxZoom: 15,
    duration: 0.8,
  });
}

function MapController({
  locatedVehicles,
  selectedVehicle,
  focusRequest,
  showAllRequest,
}) {
  const map = useMap();

  const initialized = useRef(false);
  const lastFocusRequest = useRef(0);
  const lastShowAllRequest = useRef(0);

  useEffect(() => {
    if (
      initialized.current ||
      locatedVehicles.length === 0
    ) {
      return;
    }

    initialized.current = true;

    if (locatedVehicles.length === 1) {
      const position = locatedVehicles[0].position;

      map.setView(
        [position.latitude, position.longitude],
        14
      );

      return;
    }

    const bounds = locatedVehicles.map(
      (vehicle) => [
        vehicle.position.latitude,
        vehicle.position.longitude,
      ]
    );

    map.fitBounds(bounds, {
      padding: [60, 60],
      maxZoom: 15,
    });
  }, [map, locatedVehicles]);

  useEffect(() => {
    if (
      focusRequest === 0 ||
      focusRequest === lastFocusRequest.current
    ) {
      return;
    }

    lastFocusRequest.current = focusRequest;

    if (!validCoordinates(selectedVehicle?.position)) {
      return;
    }

    map.flyTo(
      [
        selectedVehicle.position.latitude,
        selectedVehicle.position.longitude,
      ],
      16,
      { duration: 0.8 }
    );
  }, [map, selectedVehicle, focusRequest]);

  useEffect(() => {
    if (
      showAllRequest === 0 ||
      showAllRequest === lastShowAllRequest.current
    ) {
      return;
    }

    lastShowAllRequest.current = showAllRequest;

    fitVehicleBounds(map, locatedVehicles);
  }, [map, locatedVehicles, showAllRequest]);

  return null;
}

function VehicleListItem({
  vehicle,
  selected,
  onSelect,
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`mb-2 w-full rounded-xl border p-3 text-left transition ${
        selected
          ? "border-blue-500/50 bg-blue-500/10"
          : "border-white/5 bg-white/[0.025] hover:bg-white/5"
      }`}
    >
      <div className="flex items-start gap-3">
        <VehicleImage
          vehicleId={vehicle.id}
          imageUrl={vehicle.imageUrl}
          className="h-16 w-20 shrink-0 rounded-xl"
          alt={getVehicleName(vehicle)}
        />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">
            {getVehicleName(vehicle)}
          </p>

          <p className="mt-1 truncate text-xs text-slate-400">
            {vehicle.registrationNumber ||
              "No registration"}
          </p>

          <p className="mt-1 truncate text-[11px] text-slate-500">
            {getVehicleModel(vehicle)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <GpsStatusBadge status={vehicle.gpsStatus} />

        <span className="text-[11px] text-slate-400">
          {validCoordinates(vehicle.position)
            ? formatSpeed(vehicle.position)
            : "No GPS position"}
        </span>
      </div>
    </button>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 pb-3 text-sm">
      <span className="text-slate-500">
        {label}
      </span>

      <span className="text-right font-medium text-slate-200">
        {value}
      </span>
    </div>
  );
}

function SelectedVehicleDetails({ vehicle }) {
  if (!vehicle) {
    return null;
  }

  const hasPosition = validCoordinates(vehicle.position);

  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-white/10 bg-[#111827]">
      <div className="border-b border-white/10 px-5 py-4">
        <h3 className="font-bold">
          Selected Vehicle
        </h3>
      </div>

      <div className="p-5">
        <VehicleImage
          vehicleId={vehicle.id}
          imageUrl={vehicle.imageUrl}
          className="h-44 w-full rounded-xl"
          iconSize={45}
          alt={getVehicleName(vehicle)}
        />

        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 className="text-lg font-semibold">
              {getVehicleName(vehicle)}
            </h4>

            <p className="mt-1 text-sm text-slate-400">
              {getVehicleModel(vehicle)}
            </p>
          </div>

          <GpsStatusBadge status={vehicle.gpsStatus} />
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <DetailRow
            label="Registration"
            value={
              vehicle.registrationNumber ||
              "Not specified"
            }
          />

          <DetailRow
            label="GPS Device"
            value={`#${vehicle.traccarDeviceId}`}
          />

          <DetailRow
            label="Vehicle Status"
            value={vehicle.status || "unknown"}
          />

          <DetailRow
            label="Current Speed"
            value={
              hasPosition
                ? formatSpeed(vehicle.position)
                : "Not available"
            }
          />

          <DetailRow
            label="Last Reported"
            value={
              hasPosition
                ? formatTime(
                    vehicle.position.deviceTime ||
                      vehicle.position.fixTime
                  )
                : "Not available"
            }
          />
        </div>

        {!hasPosition && (
          <p className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400">
            This vehicle has no reported GPS
            coordinates yet. Its image and
            registration details remain available.
          </p>
        )}
      </div>
    </section>
  );
}

function VehicleMapPopup({ vehicle }) {
  return (
    <div className="w-[220px]">
      <VehicleImage
        vehicleId={vehicle.id}
        imageUrl={vehicle.imageUrl}
        className="mb-3 h-28 w-full rounded-lg"
        iconSize={34}
        alt={getVehicleName(vehicle)}
      />

      <h4 className="text-sm font-bold text-slate-900">
        {getVehicleName(vehicle)}
      </h4>

      <p className="mt-1 text-xs text-slate-600">
        {getVehicleModel(vehicle)}
      </p>

      <div className="mt-3 space-y-1.5 text-xs text-slate-700">
        <p>
          <strong>Registration:</strong>{" "}
          {vehicle.registrationNumber ||
            "Not specified"}
        </p>

        <p>
          <strong>GPS Status:</strong>{" "}
          {vehicle.gpsStatus || "unknown"}
        </p>

        <p>
          <strong>Speed:</strong>{" "}
          {formatSpeed(vehicle.position)}
        </p>

        <p>
          <strong>Last Reported:</strong>{" "}
          {formatTime(
            vehicle.position.deviceTime ||
              vehicle.position.fixTime
          )}
        </p>
      </div>
    </div>
  );
}

export default function LiveTrackingPage() {
  const { session } = useAuth();
  const profile = session?.profile;

  const isPersonal = profile?.customerType === "personal";

  const labels = isPersonal
    ? {
        layoutTitle: "My Tracking",
        eyebrow: "Personal Vehicle Tracking",
        heading: "My Vehicle Tracking",
        description:
          "Track your vehicles, view their photos, and monitor their latest reported GPS locations.",
        totalVehicles: "My Vehicles",
        vehicleList: "My Vehicles",
        mapTitle: "My Vehicles on Map",
        searchPlaceholder: "Search my vehicles...",
        emptyVehicles:
          "No vehicles available for tracking yet. Contact SNA Technologies to register your first vehicle.",
        noSearchResults:
          "No vehicles match your search.",
        noPositions:
          "No GPS positions available yet. Your vehicles will appear when their trackers report coordinates.",
      }
    : {
        layoutTitle: "Live Fleet Tracking",
        eyebrow: "Fleet Operations",
        heading: "Live Fleet Tracking",
        description:
          "Monitor your company's vehicles, images, and latest reported GPS locations.",
        totalVehicles: "Total Vehicles",
        vehicleList: "Fleet Vehicles",
        mapTitle: "Fleet Tracking Map",
        searchPlaceholder: "Search fleet vehicles...",
        emptyVehicles:
          "No fleet vehicles available for tracking yet.",
        noSearchResults:
          "No fleet vehicles match your search.",
        noPositions:
          "No GPS positions available yet. Fleet vehicles will appear when their trackers report coordinates.",
      };

  const [vehicles, setVehicles] = useState([]);
  const [positions, setPositions] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [mapType, setMapType] = useState("street");
  const [focusRequest, setFocusRequest] = useState(0);
  const [showAllRequest, setShowAllRequest] = useState(0);

  const requestInProgress = useRef(false);

  const loadTracking = useCallback(
    async (initial = false) => {
      if (requestInProgress.current) {
        return;
      }

      requestInProgress.current = true;

      if (initial) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      setError("");

      try {
        const response = await tenantApi.get("/vehicles");

        if (!Array.isArray(response.data)) {
          throw new Error(
            "Unexpected vehicles API response"
          );
        }

        const tenantVehicles = response.data;
        const nextPositions = {};

        await Promise.all(
          tenantVehicles.map(async (vehicle) => {
            try {
              const result = await tenantApi.get(
                `/vehicles/${vehicle.id}/position`
              );

              if (
                validCoordinates(
                  result.data?.position
                )
              ) {
                nextPositions[String(vehicle.id)] =
                  result.data.position;
              }
            } catch (requestError) {
              if (
                requestError.response?.status !== 404
              ) {
                console.error(
                  `Position request failed for vehicle ${vehicle.id}:`,
                  requestError.message
                );
              }
            }
          })
        );

        setVehicles(tenantVehicles);
        setPositions(nextPositions);
      } catch (requestError) {
        setError(
          requestError.response?.data?.message ||
            requestError.message ||
            "Unable to load live tracking"
        );
      } finally {
        requestInProgress.current = false;
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    loadTracking(true);

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        loadTracking();
      }
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [loadTracking]);

  const trackedVehicles = useMemo(
    () =>
      vehicles.map((vehicle) => ({
        ...vehicle,
        position:
          positions[String(vehicle.id)] || null,
      })),
    [vehicles, positions]
  );

  const locatedVehicles = useMemo(
    () =>
      trackedVehicles.filter((vehicle) =>
        validCoordinates(vehicle.position)
      ),
    [trackedVehicles]
  );

  const filteredVehicles = useMemo(() => {
    const query = search.trim().toLowerCase();

    if (!query) {
      return trackedVehicles;
    }

    return trackedVehicles.filter((vehicle) =>
      [
        vehicle.name,
        vehicle.registrationNumber,
        vehicle.make,
        vehicle.model,
      ].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(query)
      )
    );
  }, [trackedVehicles, search]);

  const selectedVehicle = trackedVehicles.find(
    (vehicle) =>
      String(vehicle.id) === String(selectedId)
  );

  const selectedHasPosition = validCoordinates(
    selectedVehicle?.position
  );

  const selectVehicle = (vehicle) => {
    setSelectedId(vehicle.id);

    if (validCoordinates(vehicle.position)) {
      setFocusRequest((current) => current + 1);
    }
  };

  const handleShowAll = () => {
    setShowAllRequest((current) => current + 1);
  };

  const handleRecenter = () => {
    if (!selectedHasPosition) {
      return;
    }

    setFocusRequest((current) => current + 1);
  };

  const toggleMapType = () => {
    setMapType((current) =>
      current === "street"
        ? "satellite"
        : "street"
    );
  };

  return (
    <TenantLayout title={labels.layoutTitle}>
      <main className="mx-auto max-w-7xl px-5 py-9 sm:px-8">
        {/* Heading */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-2 text-sm font-semibold text-blue-400">
              {labels.eyebrow}
            </p>

            <h2 className="text-3xl font-bold tracking-tight">
              {labels.heading}
            </h2>

            <p className="mt-3 text-sm text-slate-400">
              {labels.description}
            </p>
          </div>

          <button
            type="button"
            onClick={() => loadTracking()}
            disabled={loading || refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#111827] px-4 py-3 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw
              size={17}
              className={
                refreshing ? "animate-spin" : ""
              }
            />
            Refresh
          </button>
        </div>

        {/* Errors */}
        {error && (
          <div
            role="alert"
            className="mb-6 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400"
          >
            <CircleAlert size={18} />
            {error}
          </div>
        )}

        {/* Statistics */}
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          {[
            [
              labels.totalVehicles,
              vehicles.length,
            ],
            [
              "With GPS Position",
              locatedVehicles.length,
            ],
            [
              "Without GPS Position",
              vehicles.length - locatedVehicles.length,
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-2xl border border-white/10 bg-[#111827] p-5"
            >
              <p className="text-sm text-slate-400">
                {label}
              </p>

              <p className="mt-3 text-3xl font-bold">
                {loading || error ? "—" : value}
              </p>
            </div>
          ))}
        </div>

        {/* Vehicle List + Map */}
        <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
          {/* Sidebar */}
          <div className="min-w-0">
            <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#111827]">
              <div className="border-b border-white/10 p-5">
                <h3 className="font-bold">
                  {labels.vehicleList}
                </h3>

                <div className="relative mt-4">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                  />

                  <input
                    type="search"
                    value={search}
                    onChange={(event) =>
                      setSearch(event.target.value)
                    }
                    placeholder={labels.searchPlaceholder}
                    className="w-full rounded-xl border border-white/10 bg-[#0b1220] py-2.5 pl-10 pr-3 text-sm outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="max-h-[600px] overflow-y-auto p-3">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
                    <LoaderCircle
                      size={18}
                      className="animate-spin"
                    />
                    Loading...
                  </div>
                ) : error ? (
                  <p className="py-12 text-center text-sm text-slate-500">
                    Unable to display vehicles.
                    Try Refresh.
                  </p>
                ) : filteredVehicles.length === 0 ? (
                  <p className="py-12 px-3 text-center text-sm text-slate-500">
                    {search.trim()
                      ? labels.noSearchResults
                      : labels.emptyVehicles}
                  </p>
                ) : (
                  filteredVehicles.map((vehicle) => (
                    <VehicleListItem
                      key={vehicle.id}
                      vehicle={vehicle}
                      selected={
                        String(selectedId) ===
                        String(vehicle.id)
                      }
                      onSelect={() =>
                        selectVehicle(vehicle)
                      }
                    />
                  ))
                )}
              </div>
            </section>

            {/* Selected Vehicle Preview */}
            {selectedVehicle && (
              <SelectedVehicleDetails
                vehicle={selectedVehicle}
              />
            )}
          </div>

          {/* Map */}
          <section className="min-w-0 overflow-hidden rounded-2xl border border-white/10 bg-[#111827]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-2">
                <MapPin
                  size={18}
                  className="text-blue-400"
                />

                <h3 className="font-bold">
                  {labels.mapTitle}
                </h3>
              </div>

              <span className="text-xs text-slate-500">
                <Clock3
                  size={13}
                  className="mr-1 inline"
                />
                15-second refresh
              </span>
            </div>

            {/* Map Controls */}
            <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
              <button
                type="button"
                onClick={handleShowAll}
                disabled={locatedVehicles.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#0b1220] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Users size={15} />
                Show All
              </button>

              <button
                type="button"
                onClick={handleRecenter}
                disabled={!selectedHasPosition}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#0b1220] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Crosshair size={15} />
                Recenter
              </button>

              <button
                type="button"
                onClick={toggleMapType}
                aria-label="Toggle map and satellite view"
                aria-pressed={mapType === "satellite"}
                className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-[#0b1220] px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-white/10"
              >
                <Layers size={15} />

                {mapType === "street"
                  ? "Satellite"
                  : "Street Map"}
              </button>

              <span className="ml-auto text-xs text-slate-500">
                {locatedVehicles.length} located
              </span>
            </div>

            {/* Leaflet Map */}
            <div className="relative h-[600px]">
              <MapContainer
                center={DEFAULT_CENTER}
                zoom={11}
                scrollWheelZoom
                className="h-full w-full"
              >
                {mapType === "street" ? (
                  <TileLayer
                    key="street"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url={STREET_TILES}
                  />
                ) : (
                  <TileLayer
                    key="satellite"
                    attribution="Tiles &copy; Esri and its imagery providers"
                    url={SATELLITE_TILES}
                    maxZoom={19}
                  />
                )}

                <MapController
                  locatedVehicles={locatedVehicles}
                  selectedVehicle={selectedVehicle}
                  focusRequest={focusRequest}
                  showAllRequest={showAllRequest}
                />

                {locatedVehicles.map((vehicle) => (
                  <CircleMarker
                    key={vehicle.id}
                    center={[
                      vehicle.position.latitude,
                      vehicle.position.longitude,
                    ]}
                    radius={9}
                    pathOptions={{
                      color:
                        vehicle.gpsStatus === "online"
                          ? "#10b981"
                          : "#f59e0b",
                      fillOpacity: 0.9,
                    }}
                    eventHandlers={{
                      click: () =>
                        selectVehicle(vehicle),
                    }}
                  >
                    <Tooltip direction="top">
                      {getVehicleName(vehicle)}
                    </Tooltip>

                    <Popup>
                      <VehicleMapPopup
                        vehicle={vehicle}
                      />
                    </Popup>
                  </CircleMarker>
                ))}
              </MapContainer>

              {!loading &&
                !error &&
                locatedVehicles.length === 0 && (
                  <div className="pointer-events-none absolute bottom-5 left-1/2 z-[500] w-[90%] max-w-md -translate-x-1/2 rounded-xl border border-white/10 bg-[#111827]/95 p-4 text-center text-sm text-slate-300 shadow-xl">
                    {labels.noPositions}
                  </div>
                )}
            </div>
          </section>
        </div>
      </main>
    </TenantLayout>
  );
}
