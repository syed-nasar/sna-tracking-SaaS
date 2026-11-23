import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Check,
  CircleAlert,
  ImagePlus,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Truck,
  Upload,
  X,
} from "lucide-react";

import TenantLayout from "../components/TenantLayout";
import FleetGroupFilter from "../components/FleetGroupFilter";
import VehicleOperations from "../components/VehicleOperations";
import { useAuth } from "../context/AuthContext";
import { tenantApi } from "../services/api";

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const EMPTY_FORM = {
  name: "",
  registrationNumber: "",
  make: "",
  model: "",
  traccarDeviceId: "",
  status: "active",
};

const inputClass =
  "w-full rounded-xl border border-white/10 bg-[#0b1220] px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-blue-500";

function getErrorMessage(error, fallback) {
  return (
    error.response?.data?.message ||
    error.message ||
    fallback
  );
}

function StatusBadge({ value, type = "vehicle" }) {
  const status = String(value || "unknown").toLowerCase();

  let style = "bg-slate-500/10 text-slate-400";

  if (status === "active" || status === "online") {
    style = "bg-emerald-500/10 text-emerald-400";
  } else if (
    status === "offline" ||
    status === "inactive"
  ) {
    style =
      type === "gps"
        ? "bg-amber-500/10 text-amber-400"
        : "bg-slate-500/10 text-slate-400";
  }

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${style}`}
    >
      {status}
    </span>
  );
}

function FormField({
  label,
  required = false,
  children,
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-slate-300">
        {label}
        {required && (
          <span className="ml-1 text-red-400">*</span>
        )}
      </span>
      {children}
    </label>
  );
}

// Images require Bearer authentication.
// Fetch the image as a Blob instead of using
// the database imageUrl directly in an img tag.
function VehicleImage({
  vehicleId,
  imageUrl,
  className = "",
}) {
  const [source, setSource] = useState(null);

  useEffect(() => {
    if (!vehicleId || !imageUrl) {
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

        if (cancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(response.data);
        setSource(objectUrl);
      } catch {
        if (!cancelled) {
          setSource(null);
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
  }, [vehicleId, imageUrl]);

  if (!imageUrl || !source) {
    return (
      <div
        className={`flex items-center justify-center bg-blue-500/10 text-blue-400 ${className}`}
      >
        <Truck size={24} />
      </div>
    );
  }

  return (
    <img
      src={source}
      alt="Vehicle"
      className={`object-cover ${className}`}
    />
  );
}

export default function VehiclesPage() {
  const { session } = useAuth();

  const profile = session?.profile;
  const role = profile?.role;
  const isPersonal = profile?.customerType === "personal";
  const isBusiness = profile?.customerType === "business";
  const labels = isPersonal
    ? {
        layoutTitle: "My Vehicles",
        eyebrow: "Personal Vehicle Tracking",
        heading: "My Vehicles",
        description: "View and manage your vehicles, GPS trackers, and vehicle photos.",
        directoryTitle: "My Vehicle Directory",
        searchPlaceholder: "Search my vehicles...",
        emptyMessage: "You haven't added any vehicles yet. Contact SNA Technologies to register your first vehicle and start tracking.",
        noDevicesMessage: "No unused GPS devices are allocated to your account. Contact SNA Technologies.",
      }
    : {
        layoutTitle: "Vehicle Management",
        eyebrow: "Fleet Operations",
        heading: "Company Vehicles",
        description: "View vehicles, manage GPS tracker associations, and upload vehicle photos.",
        directoryTitle: "Vehicle Directory",
        searchPlaceholder: "Search fleet vehicles...",
        emptyMessage: "No vehicles registered for your company yet.",
        noDevicesMessage: "No unused GPS devices are allocated to your company. Contact your platform administrator.",
      };

  const canManage =
    role === "tenant_admin" ||
    role === "manager";

  const [vehicles, setVehicles] = useState([]);
  const [availableDevices, setAvailableDevices] =
    useState([]);

  const [loading, setLoading] = useState(true);
  const [devicesLoading, setDevicesLoading] =
    useState(false);
  const [saving, setSaving] = useState(false);
  const [removingImage, setRemovingImage] =
    useState(false);

  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");

  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [operationsId, setOperationsId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] =
    useState(null);

  const [form, setForm] = useState({
    ...EMPTY_FORM,
  });

  const [selectedImage, setSelectedImage] =
    useState(null);
  const [imageType, setImageType] =
    useState("photo");
  const [previewUrl, setPreviewUrl] =
    useState(null);

  const loadVehicles = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const response = await tenantApi.get(
        "/vehicles"
      );

      if (!Array.isArray(response.data)) {
        throw new Error(
          "Unexpected vehicles API response"
        );
      }

      setVehicles(response.data);
    } catch (err) {
      setError(
        getErrorMessage(
          err,
          "Unable to load vehicles"
        )
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  // Release local image previews when replaced
  // or when the component unmounts.
  useEffect(() => {
    if (!selectedImage) {
      setPreviewUrl(null);
      return undefined;
    }

    const url = URL.createObjectURL(
      selectedImage
    );

    setPreviewUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [selectedImage]);

  const activeGroup = isBusiness && (groupFilter === "ungrouped" ||
    vehicles.some((vehicle) => vehicle.groupId === groupFilter)) ? groupFilter : "";
  const operationsVehicle = vehicles.find((vehicle) => vehicle.id === operationsId);

  const filteredVehicles = useMemo(() => {
    const query = search.trim().toLowerCase();

    return vehicles.filter((vehicle) =>
      (!activeGroup || (vehicle.groupId ?? "ungrouped") === activeGroup) &&
      (!query || [
        vehicle.name,
        vehicle.registrationNumber,
        vehicle.make,
        vehicle.model,
        vehicle.traccarDeviceId,
        vehicle.id,
        vehicle.fleetNumber,
        vehicle.groupName,
        vehicle.driverName,
      ].some((value) =>
        String(value ?? "")
          .toLowerCase()
          .includes(query)
      ))
    );
  }, [vehicles, search, activeGroup]);

  const loadAvailableDevices = async () => {
    setDevicesLoading(true);
    setFormError("");

    try {
      const response = await tenantApi.get(
        "/vehicles/available-devices"
      );

      if (!Array.isArray(response.data)) {
        throw new Error(
          "Unexpected GPS devices API response"
        );
      }

      setAvailableDevices(response.data);
    } catch (err) {
      setAvailableDevices([]);

      setFormError(
        getErrorMessage(
          err,
          "Unable to load available GPS devices"
        )
      );
    } finally {
      setDevicesLoading(false);
    }
  };

  const resetImageSelection = () => {
    setSelectedImage(null);
    setImageType("photo");
  };

  const openAddModal = () => {
    if (!canManage) return;

    setEditingVehicle(null);
    setForm({ ...EMPTY_FORM });
    setFormError("");
    setSuccess("");
    setAvailableDevices([]);
    resetImageSelection();
    setModalOpen(true);

    loadAvailableDevices();
  };

  const openEditModal = (vehicle) => {
    if (!canManage) return;

    setEditingVehicle(vehicle);

    setForm({
      name: vehicle.name || "",
      registrationNumber:
        vehicle.registrationNumber || "",
      make: vehicle.make || "",
      model: vehicle.model || "",
      traccarDeviceId: String(
        vehicle.traccarDeviceId || ""
      ),
      status: vehicle.status || "active",
    });

    setImageType(
      vehicle.imageType || "photo"
    );

    setSelectedImage(null);
    setFormError("");
    setSuccess("");
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving || removingImage) return;

    setModalOpen(false);
    setEditingVehicle(null);
    setFormError("");
    resetImageSelection();
  };

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleImageSelection = (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/webp",
    ];

    if (!allowedTypes.includes(file.type)) {
      setFormError(
        "Please select a JPG, PNG, or WebP image."
      );
      event.target.value = "";
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      setFormError(
        "Vehicle image must be 5 MB or smaller."
      );
      event.target.value = "";
      return;
    }

    setSelectedImage(file);
    setFormError("");
    event.target.value = "";
  };

  const uploadVehicleImage = async (
    vehicleId,
    file
  ) => {
    const data = new FormData();

    data.append("image", file);
    data.append("imageType", imageType);

    await tenantApi.post(
      `/vehicles/${vehicleId}/image`,
      data,
      {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      }
    );
  };

  const handleRemoveImage = async () => {
    if (
      !editingVehicle ||
      !editingVehicle.imageUrl ||
      removingImage ||
      saving
    ) {
      return;
    }

    setRemovingImage(true);
    setFormError("");

    try {
      await tenantApi.delete(
        `/vehicles/${editingVehicle.id}/image`
      );

      setEditingVehicle((current) => ({
        ...current,
        imageUrl: null,
        imageType: null,
      }));

      setVehicles((current) =>
        current.map((vehicle) =>
          String(vehicle.id) ===
          String(editingVehicle.id)
            ? {
                ...vehicle,
                imageUrl: null,
                imageType: null,
              }
            : vehicle
        )
      );

      resetImageSelection();
      setSuccess(
        "Vehicle image removed successfully."
      );
    } catch (err) {
      setFormError(
        getErrorMessage(
          err,
          "Unable to remove vehicle image"
        )
      );
    } finally {
      setRemovingImage(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!canManage || saving) return;

    setSaving(true);
    setFormError("");
    setSuccess("");

    let savedVehicleId = null;

    try {
      if (editingVehicle) {
        const response = await tenantApi.patch(
          `/vehicles/${editingVehicle.id}`,
          {
            name: form.name.trim(),
            registrationNumber:
              form.registrationNumber.trim() ||
              null,
            make: form.make.trim() || null,
            model: form.model.trim() || null,
            status: form.status,
          }
        );

        savedVehicleId = response.data.id;
      } else {
        if (!form.traccarDeviceId) {
          throw new Error(
            "Please select an available GPS device."
          );
        }

        const response = await tenantApi.post(
          "/vehicles",
          {
            name: form.name.trim(),
            registrationNumber:
              form.registrationNumber.trim() ||
              null,
            make: form.make.trim() || null,
            model: form.model.trim() || null,
            traccarDeviceId:
              form.traccarDeviceId,
          }
        );

        savedVehicleId = response.data.id;
      }

      if (selectedImage) {
        try {
          await uploadVehicleImage(
            savedVehicleId,
            selectedImage
          );
        } catch (uploadError) {
          setFormError(
            `Vehicle details were saved, but image upload failed: ${getErrorMessage(
              uploadError,
              "Unknown upload error"
            )}`
          );

          await loadVehicles();
          return;
        }
      }

      setSuccess(
        editingVehicle
          ? "Vehicle updated successfully."
          : "Vehicle created successfully."
      );

      setModalOpen(false);
      setEditingVehicle(null);
      resetImageSelection();

      await loadVehicles();
    } catch (err) {
      setFormError(
        getErrorMessage(
          err,
          "Unable to save vehicle"
        )
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <TenantLayout title={labels.layoutTitle}>
      <main className="mx-auto max-w-7xl px-5 py-9 sm:px-8">
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

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadVehicles}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-[#111827] px-4 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw
                size={17}
                className={
                  loading ? "animate-spin" : ""
                }
              />
              Refresh
            </button>

            {canManage && (
              <button
                type="button"
                onClick={openAddModal}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold transition hover:bg-blue-500"
              >
                <Plus size={18} />
                Add Vehicle
              </button>
            )}
          </div>
        </div>

        {success && (
          <div
            role="status"
            className="mb-6 flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-400"
          >
            <Check size={18} />
            {success}
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-6 flex items-center gap-3 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400"
          >
            <CircleAlert size={18} />
            {error}
          </div>
        )}

        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#111827]">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 p-6">
            <div>
              <h3 className="text-lg font-bold">
                {labels.directoryTitle}
              </h3>

              <p className="mt-1 text-sm text-slate-500">
                {vehicles.length} registered vehicles
              </p>
            </div>

            {isBusiness && (
              <div className="w-full sm:w-52">
                <FleetGroupFilter vehicles={vehicles} value={activeGroup} onChange={setGroupFilter} />
              </div>
            )}
            <div className="relative w-full sm:w-72">
              <Search
                size={17}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />

              <input
                type="search"
                value={search}
                onChange={(event) =>
                  setSearch(event.target.value)
                }
                placeholder={labels.searchPlaceholder}
                className={`${inputClass} pl-10`}
              />
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center gap-3 py-20 text-slate-400">
              <LoaderCircle
                size={22}
                className="animate-spin"
              />
              Loading vehicles...
            </div>
          ) : error ? (
            <div className="py-20 text-center text-sm text-slate-500">
              Unable to display vehicles.
              Try refreshing.
            </div>
          ) : filteredVehicles.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <Truck
                size={35}
                className="text-slate-600"
              />

              <p className="text-sm text-slate-400">
                {activeGroup
                  ? "No vehicles match your filters."
                  : search ? "No vehicles match your search." : labels.emptyMessage}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left">
                <thead className="bg-white/[0.025] text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    {[
                      "Vehicle",
                      "Registration",
                      "GPS Device",
                      "GPS Status",
                      "Vehicle Status",
                      "Actions",
                    ].map((heading) => (
                      <th
                        key={heading}
                        className="px-6 py-4 font-semibold"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {filteredVehicles.map((vehicle) => (
                    <tr
                      key={vehicle.id}
                      className="border-t border-white/5 transition hover:bg-white/[0.025]"
                    >
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <VehicleImage
                            vehicleId={vehicle.id}
                            imageUrl={vehicle.imageUrl}
                            className="h-14 w-20 shrink-0 rounded-xl"
                          />

                          <div>
                            <p className="font-semibold">
                              {vehicle.name ||
                                `Vehicle ${vehicle.id}`}
                            </p>
                            {isBusiness && (vehicle.groupName || vehicle.driverName) && (
                              <p className="mt-1 text-xs text-slate-400">
                                {[vehicle.groupName, vehicle.driverName].filter(Boolean).join(" · ")}
                              </p>
                            )}

                            <p className="mt-1 text-xs text-slate-500">
                              {[
                                vehicle.make,
                                vehicle.model,
                              ]
                                .filter(Boolean)
                                .join(" ") ||
                                "No model specified"}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="px-6 py-5 text-sm text-slate-400">
                        {vehicle.registrationNumber ||
                          "—"}
                      </td>

                      <td className="px-6 py-5 text-sm text-slate-400">
                        #{vehicle.traccarDeviceId}
                      </td>

                      <td className="px-6 py-5">
                        <StatusBadge
                          value={vehicle.gpsStatus}
                          type="gps"
                        />
                      </td>

                      <td className="px-6 py-5">
                        <StatusBadge
                          value={vehicle.status}
                        />
                      </td>

                      <td className="px-6 py-5">
                        {isBusiness && (
                          <button type="button" onClick={() => setOperationsId(vehicle.id)}
                            aria-label={`Operations for ${vehicle.name}`}
                            className="mr-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/10">
                            Operations
                          </button>
                        )}
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() =>
                              openEditModal(vehicle)
                            }
                            className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/10"
                          >
                            <Pencil size={14} />
                            Edit
                          </button>
                        ) : !isBusiness && (
                          <span className="text-xs text-slate-600">
                            View only
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="border-t border-white/10 px-6 py-4 text-xs text-slate-500">
            Showing{" "}
            {error ? 0 : filteredVehicles.length}{" "}
            of {error ? 0 : vehicles.length}{" "}
            vehicles
          </div>
        </section>
      </main>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="vehicle-modal-title"
            className="my-auto w-full max-w-xl rounded-2xl border border-white/10 bg-[#111827] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-white/10 p-6">
              <div>
                <h3
                  id="vehicle-modal-title"
                  className="text-xl font-bold"
                >
                  {editingVehicle
                    ? "Edit Vehicle"
                    : "Add Vehicle"}
                </h3>

                <p className="mt-1 text-sm text-slate-500">
                  {editingVehicle
                    ? "Update vehicle information and image."
                    : "Register a vehicle using an allocated GPS device."}
                </p>
              </div>

              <button
                type="button"
                onClick={closeModal}
                disabled={saving || removingImage}
                aria-label="Close form"
                className="text-slate-400 hover:text-white disabled:opacity-50"
              >
                <X size={22} />
              </button>
            </div>

            <form
              onSubmit={handleSubmit}
              className="max-h-[75vh] space-y-5 overflow-y-auto p-6"
            >
              {formError && (
                <div
                  role="alert"
                  className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400"
                >
                  {formError}
                </div>
              )}

              <FormField
                label="Vehicle Name"
                required
              >
                <input
                  className={inputClass}
                  value={form.name}
                  onChange={(event) =>
                    updateField(
                      "name",
                      event.target.value
                    )
                  }
                  placeholder="e.g. Toyota Corolla"
                  maxLength={150}
                  required
                />
              </FormField>

              <FormField label="Registration Number">
                <input
                  className={inputClass}
                  value={form.registrationNumber}
                  onChange={(event) =>
                    updateField(
                      "registrationNumber",
                      event.target.value
                    )
                  }
                  placeholder="e.g. ABC-123"
                  maxLength={50}
                />
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Make">
                  <input
                    className={inputClass}
                    value={form.make}
                    onChange={(event) =>
                      updateField(
                        "make",
                        event.target.value
                      )
                    }
                    placeholder="Toyota"
                    maxLength={100}
                  />
                </FormField>

                <FormField label="Model">
                  <input
                    className={inputClass}
                    value={form.model}
                    onChange={(event) =>
                      updateField(
                        "model",
                        event.target.value
                      )
                    }
                    placeholder="Corolla"
                    maxLength={100}
                  />
                </FormField>
              </div>

              {editingVehicle ? (
                <>
                  <FormField label="GPS Device">
                    <input
                      className={`${inputClass} cursor-not-allowed opacity-60`}
                      value={`Device #${form.traccarDeviceId}`}
                      disabled
                    />
                  </FormField>

                  <FormField label="Vehicle Status">
                    <select
                      className={inputClass}
                      value={form.status}
                      onChange={(event) =>
                        updateField(
                          "status",
                          event.target.value
                        )
                      }
                    >
                      <option value="active">
                        Active
                      </option>
                      <option value="inactive">
                        Inactive
                      </option>
                    </select>
                  </FormField>
                </>
              ) : (
                <FormField
                  label="Available GPS Device"
                  required
                >
                  <select
                    className={inputClass}
                    value={form.traccarDeviceId}
                    onChange={(event) =>
                      updateField(
                        "traccarDeviceId",
                        event.target.value
                      )
                    }
                    disabled={
                      devicesLoading ||
                      availableDevices.length === 0
                    }
                    required
                  >
                    <option value="">
                      {devicesLoading
                        ? "Loading GPS devices..."
                        : "Select a GPS device"}
                    </option>

                    {availableDevices.map((device) => (
                      <option
                        key={device.traccarDeviceId}
                        value={device.traccarDeviceId}
                      >
                        {device.deviceName} —{" "}
                        {device.uniqueId} (#
                        {device.traccarDeviceId})
                      </option>
                    ))}
                  </select>

                  {!devicesLoading &&
                    !formError &&
                    availableDevices.length === 0 && (
                      <p className="mt-2 text-xs text-amber-400">
                        {labels.noDevicesMessage}
                      </p>
                    )}
                </FormField>
              )}

              {/* Vehicle Image Section */}
              <div className="rounded-2xl border border-white/10 bg-[#0b1220] p-4">
                <div className="mb-4 flex items-center gap-2">
                  <ImagePlus
                    size={19}
                    className="text-blue-400"
                  />

                  <h4 className="text-sm font-semibold">
                    Vehicle Image
                  </h4>
                </div>

                <div className="mb-4 overflow-hidden rounded-xl border border-white/10">
                  {previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Selected vehicle preview"
                      className="h-44 w-full object-contain bg-black/20"
                    />
                  ) : editingVehicle?.imageUrl ? (
                    <VehicleImage
                      vehicleId={editingVehicle.id}
                      imageUrl={editingVehicle.imageUrl}
                      className="h-44 w-full"
                    />
                  ) : (
                    <div className="flex h-44 flex-col items-center justify-center gap-3 bg-white/[0.025] text-slate-500">
                      <Truck size={40} />
                      <p className="text-xs">
                        No vehicle image selected
                      </p>
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-medium text-slate-400">
                      Image Type
                    </label>

                    <select
                      value={imageType}
                      onChange={(event) =>
                        setImageType(
                          event.target.value
                        )
                      }
                      disabled={saving || removingImage}
                      className={inputClass}
                    >
                      <option value="photo">
                        Real Photo
                      </option>

                      <option value="illustration">
                        Illustration
                      </option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-xs font-medium text-slate-400">
                      Upload Image
                    </label>

                    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-blue-500/40 bg-blue-500/5 px-4 py-3 text-sm text-blue-400 transition hover:bg-blue-500/10">
                      <Upload size={17} />

                      {selectedImage
                        ? "Change Image"
                        : "Choose Image"}

                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleImageSelection}
                        disabled={saving || removingImage}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {selectedImage && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2">
                    <p className="truncate text-xs text-slate-300">
                      {selectedImage.name}
                    </p>

                    <button
                      type="button"
                      onClick={() =>
                        setSelectedImage(null)
                      }
                      disabled={saving}
                      aria-label="Clear selected image"
                      className="text-slate-400 hover:text-white"
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}

                {editingVehicle?.imageUrl &&
                  !selectedImage && (
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      disabled={
                        saving || removingImage
                      }
                      className="mt-3 inline-flex items-center gap-2 text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                    >
                      {removingImage ? (
                        <LoaderCircle
                          size={15}
                          className="animate-spin"
                        />
                      ) : (
                        <Trash2 size={15} />
                      )}

                      Remove Current Image
                    </button>
                  )}

                <p className="mt-3 text-xs text-slate-500">
                  JPG, PNG, or WebP. Maximum 5 MB.
                  Images are accessible only through
                  authenticated vehicle APIs.
                </p>
              </div>

              <div className="flex justify-end gap-3 border-t border-white/10 pt-5">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving || removingImage}
                  className="rounded-xl border border-white/10 px-5 py-3 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={
                    saving ||
                    removingImage ||
                    (!editingVehicle &&
                      (devicesLoading ||
                        availableDevices.length === 0 ||
                        !form.traccarDeviceId))
                  }
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving && (
                    <LoaderCircle
                      size={17}
                      className="animate-spin"
                    />
                  )}

                  {saving
                    ? "Saving..."
                    : editingVehicle
                      ? "Save Changes"
                      : "Create Vehicle"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {isBusiness && operationsVehicle && (
        <VehicleOperations key={operationsVehicle.id} vehicle={operationsVehicle} canManage={canManage}
          onClose={() => setOperationsId(null)} onSaved={loadVehicles} />
      )}
    </TenantLayout>
  );
}
