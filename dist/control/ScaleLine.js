var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
/**
 * @module ol/control/ScaleLine
 */
import Control from './Control.js';
import ProjUnits from '../proj/Units.js';
import { CLASS_UNSELECTABLE } from '../css.js';
import { METERS_PER_UNIT, getPointResolution } from '../proj.js';
import { assert } from '../asserts.js';
/**
 * @type {string}
 */
var UNITS_PROP = 'units';
/**
 * Units for the scale line. Supported values are `'degrees'`, `'imperial'`,
 * `'nautical'`, `'metric'`, `'us'`.
 * @enum {string}
 */
export var Units = {
    DEGREES: 'degrees',
    IMPERIAL: 'imperial',
    NAUTICAL: 'nautical',
    METRIC: 'metric',
    US: 'us',
};
/**
 * @const
 * @type {Array<number>}
 */
var LEADING_DIGITS = [1, 2, 5];
/**
 * @const
 * @type {number}
 */
var DEFAULT_DPI = 25.4 / 0.28;
/***
 * @template Return
 * @typedef {import("../Observable").OnSignature<import("../Observable").EventTypes, import("../events/Event.js").default, Return> &
 *   import("../Observable").OnSignature<import("../ObjectEventType").Types|
 *     'change:units', import("../Object").ObjectEvent, Return> &
 *   import("../Observable").CombinedOnSignature<import("../Observable").EventTypes|import("../ObjectEventType").Types
 *     |'change:units', Return>} ScaleLineOnSignature
 */
/**
 * @typedef {Object} Options
 * @property {string} [className='ol-scale-line'] CSS Class name.
 * @property {number} [minWidth=64] Minimum width in pixels at the OGC default dpi. The width will be
 * adjusted to match the dpi used.
 * @property {function(import("../MapEvent.js").default):void} [render] Function called when the control
 * should be re-rendered. This is called in a `requestAnimationFrame` callback.
 * @property {HTMLElement|string} [target] Specify a target if you want the control
 * to be rendered outside of the map's viewport.
 * @property {import("./ScaleLine.js").Units|string} [units='metric'] Units.
 * @property {boolean} [bar=false] Render scalebars instead of a line.
 * @property {number} [steps=4] Number of steps the scalebar should use. Use even numbers
 * for best results. Only applies when `bar` is `true`.
 * @property {boolean} [text=false] Render the text scale above of the scalebar. Only applies
 * when `bar` is `true`.
 * @property {number|undefined} [dpi=undefined] dpi of output device such as printer. Only applies
 * when `bar` is `true`. If undefined the OGC default screen pixel size of 0.28mm will be assumed.
 */
/**
 * @classdesc
 * A control displaying rough y-axis distances, calculated for the center of the
 * viewport. For conformal projections (e.g. EPSG:3857, the default view
 * projection in OpenLayers), the scale is valid for all directions.
 * No scale line will be shown when the y-axis distance of a pixel at the
 * viewport center cannot be calculated in the view projection.
 * By default the scale line will show in the bottom left portion of the map,
 * but this can be changed by using the css selector `.ol-scale-line`.
 * When specifying `bar` as `true`, a scalebar will be rendered instead
 * of a scaleline.
 *
 * @api
 */
var ScaleLine = /** @class */ (function (_super) {
    __extends(ScaleLine, _super);
    /**
     * @param {Options} [opt_options] Scale line options.
     */
    function ScaleLine(opt_options) {
        var _this = this;
        var options = opt_options ? opt_options : {};
        var className = options.className !== undefined
            ? options.className
            : options.bar
                ? 'ol-scale-bar'
                : 'ol-scale-line';
        _this = _super.call(this, {
            element: document.createElement('div'),
            render: options.render,
            target: options.target,
        }) || this;
        /***
         * @type {ScaleLineOnSignature<import("../events").EventsKey>}
         */
        _this.on;
        /***
         * @type {ScaleLineOnSignature<import("../events").EventsKey>}
         */
        _this.once;
        /***
         * @type {ScaleLineOnSignature<void>}
         */
        _this.un;
        /**
         * @private
         * @type {HTMLElement}
         */
        _this.innerElement_ = document.createElement('div');
        _this.innerElement_.className = className + '-inner';
        _this.element.className = className + ' ' + CLASS_UNSELECTABLE;
        _this.element.appendChild(_this.innerElement_);
        /**
         * @private
         * @type {?import("../View.js").State}
         */
        _this.viewState_ = null;
        /**
         * @private
         * @type {number}
         */
        _this.minWidth_ = options.minWidth !== undefined ? options.minWidth : 64;
        /**
         * @private
         * @type {boolean}
         */
        _this.renderedVisible_ = false;
        /**
         * @private
         * @type {number|undefined}
         */
        _this.renderedWidth_ = undefined;
        /**
         * @private
         * @type {string}
         */
        _this.renderedHTML_ = '';
        _this.addChangeListener(UNITS_PROP, _this.handleUnitsChanged_);
        _this.setUnits(options.units || Units.METRIC);
        /**
         * @private
         * @type {boolean}
         */
        _this.scaleBar_ = options.bar || false;
        /**
         * @private
         * @type {number}
         */
        _this.scaleBarSteps_ = options.steps || 4;
        /**
         * @private
         * @type {boolean}
         */
        _this.scaleBarText_ = options.text || false;
        /**
         * @private
         * @type {number|undefined}
         */
        _this.dpi_ = options.dpi || undefined;
        return _this;
    }
    /**
     * Return the units to use in the scale line.
     * @return {import("./ScaleLine.js").Units} The units
     * to use in the scale line.
     * @observable
     * @api
     */
    ScaleLine.prototype.getUnits = function () {
        return this.get(UNITS_PROP);
    };
    /**
     * @private
     */
    ScaleLine.prototype.handleUnitsChanged_ = function () {
        this.updateElement_();
    };
    /**
     * Set the units to use in the scale line.
     * @param {import("./ScaleLine.js").Units} units The units to use in the scale line.
     * @observable
     * @api
     */
    ScaleLine.prototype.setUnits = function (units) {
        this.set(UNITS_PROP, units);
    };
    /**
     * Specify the dpi of output device such as printer.
     * @param {number|undefined} dpi The dpi of output device.
     * @api
     */
    ScaleLine.prototype.setDpi = function (dpi) {
        this.dpi_ = dpi;
    };
    /**
     * @private
     */
    ScaleLine.prototype.updateElement_ = function () {
        var viewState = this.viewState_;
        if (!viewState) {
            if (this.renderedVisible_) {
                this.element.style.display = 'none';
                this.renderedVisible_ = false;
            }
            return;
        }
        var center = viewState.center;
        var projection = viewState.projection;
        var units = this.getUnits();
        var pointResolutionUnits = units == Units.DEGREES ? ProjUnits.DEGREES : ProjUnits.METERS;
        var pointResolution = getPointResolution(projection, viewState.resolution, center, pointResolutionUnits);
        var minWidth = (this.minWidth_ * (this.dpi_ || DEFAULT_DPI)) / DEFAULT_DPI;
        var nominalCount = minWidth * pointResolution;
        var suffix = '';
        if (units == Units.DEGREES) {
            var metersPerDegree = METERS_PER_UNIT[ProjUnits.DEGREES];
            nominalCount *= metersPerDegree;
            if (nominalCount < metersPerDegree / 60) {
                suffix = '\u2033'; // seconds
                pointResolution *= 3600;
            }
            else if (nominalCount < metersPerDegree) {
                suffix = '\u2032'; // minutes
                pointResolution *= 60;
            }
            else {
                suffix = '\u00b0'; // degrees
            }
        }
        else if (units == Units.IMPERIAL) {
            if (nominalCount < 0.9144) {
                suffix = 'in';
                pointResolution /= 0.0254;
            }
            else if (nominalCount < 1609.344) {
                suffix = 'ft';
                pointResolution /= 0.3048;
            }
            else {
                suffix = 'mi';
                pointResolution /= 1609.344;
            }
        }
        else if (units == Units.NAUTICAL) {
            pointResolution /= 1852;
            suffix = 'nm';
        }
        else if (units == Units.METRIC) {
            if (nominalCount < 0.001) {
                suffix = 'μm';
                pointResolution *= 1000000;
            }
            else if (nominalCount < 1) {
                suffix = 'mm';
                pointResolution *= 1000;
            }
            else if (nominalCount < 1000) {
                suffix = 'm';
            }
            else {
                suffix = 'km';
                pointResolution /= 1000;
            }
        }
        else if (units == Units.US) {
            if (nominalCount < 0.9144) {
                suffix = 'in';
                pointResolution *= 39.37;
            }
            else if (nominalCount < 1609.344) {
                suffix = 'ft';
                pointResolution /= 0.30480061;
            }
            else {
                suffix = 'mi';
                pointResolution /= 1609.3472;
            }
        }
        else {
            assert(false, 33); // Invalid units
        }
        var i = 3 * Math.floor(Math.log(minWidth * pointResolution) / Math.log(10));
        var count, width, decimalCount;
        while (true) {
            decimalCount = Math.floor(i / 3);
            var decimal = Math.pow(10, decimalCount);
            count = LEADING_DIGITS[((i % 3) + 3) % 3] * decimal;
            width = Math.round(count / pointResolution);
            if (isNaN(width)) {
                this.element.style.display = 'none';
                this.renderedVisible_ = false;
                return;
            }
            else if (width >= minWidth) {
                break;
            }
            ++i;
        }
        var html;
        if (this.scaleBar_) {
            html = this.createScaleBar(width, count, suffix);
        }
        else {
            html = count.toFixed(decimalCount < 0 ? -decimalCount : 0) + ' ' + suffix;
        }
        if (this.renderedHTML_ != html) {
            this.innerElement_.innerHTML = html;
            this.renderedHTML_ = html;
        }
        if (this.renderedWidth_ != width) {
            this.innerElement_.style.width = width + 'px';
            this.renderedWidth_ = width;
        }
        if (!this.renderedVisible_) {
            this.element.style.display = '';
            this.renderedVisible_ = true;
        }
    };
    /**
     * @private
     * @param {number} width The current width of the scalebar.
     * @param {number} scale The current scale.
     * @param {string} suffix The suffix to append to the scale text.
     * @return {string} The stringified HTML of the scalebar.
     */
    ScaleLine.prototype.createScaleBar = function (width, scale, suffix) {
        var mapScale = '1 : ' + Math.round(this.getScaleForResolution()).toLocaleString();
        var scaleSteps = [];
        var stepWidth = width / this.scaleBarSteps_;
        var backgroundColor = '#ffffff';
        for (var i = 0; i < this.scaleBarSteps_; i++) {
            if (i === 0) {
                // create the first marker at position 0
                scaleSteps.push(this.createMarker('absolute', i));
            }
            scaleSteps.push('<div>' +
                '<div ' +
                'class="ol-scale-singlebar" ' +
                'style=' +
                '"width: ' +
                stepWidth +
                'px;' +
                'background-color: ' +
                backgroundColor +
                ';"' +
                '>' +
                '</div>' +
                this.createMarker('relative', i) +
                /*render text every second step, except when only 2 steps */
                (i % 2 === 0 || this.scaleBarSteps_ === 2
                    ? this.createStepText(i, width, false, scale, suffix)
                    : '') +
                '</div>');
            if (i === this.scaleBarSteps_ - 1) {
                {
                    /*render text at the end */
                }
                scaleSteps.push(this.createStepText(i + 1, width, true, scale, suffix));
            }
            // switch colors of steps between black and white
            if (backgroundColor === '#ffffff') {
                backgroundColor = '#000000';
            }
            else {
                backgroundColor = '#ffffff';
            }
        }
        var scaleBarText;
        if (this.scaleBarText_) {
            scaleBarText =
                '<div ' +
                    'class="ol-scale-text" ' +
                    'style="width: ' +
                    width +
                    'px;">' +
                    mapScale +
                    '</div>';
        }
        else {
            scaleBarText = '';
        }
        var container = '<div ' +
            'style="display: flex;">' +
            scaleBarText +
            scaleSteps.join('') +
            '</div>';
        return container;
    };
    /**
     * Creates a marker at given position
     * @param {string} position The position, absolute or relative
     * @param {number} i The iterator
     * @return {string} The stringified div containing the marker
     */
    ScaleLine.prototype.createMarker = function (position, i) {
        var top = position === 'absolute' ? 3 : -10;
        return ('<div ' +
            'class="ol-scale-step-marker" ' +
            'style="position: ' +
            position +
            ';' +
            'top: ' +
            top +
            'px;"' +
            '></div>');
    };
    /**
     * Creates the label for a marker marker at given position
     * @param {number} i The iterator
     * @param {number} width The width the scalebar will currently use
     * @param {boolean} isLast Flag indicating if we add the last step text
     * @param {number} scale The current scale for the whole scalebar
     * @param {string} suffix The suffix for the scale
     * @return {string} The stringified div containing the step text
     */
    ScaleLine.prototype.createStepText = function (i, width, isLast, scale, suffix) {
        var length = i === 0 ? 0 : Math.round((scale / this.scaleBarSteps_) * i * 100) / 100;
        var lengthString = length + (i === 0 ? '' : ' ' + suffix);
        var margin = i === 0 ? -3 : (width / this.scaleBarSteps_) * -1;
        var minWidth = i === 0 ? 0 : (width / this.scaleBarSteps_) * 2;
        return ('<div ' +
            'class="ol-scale-step-text" ' +
            'style="' +
            'margin-left: ' +
            margin +
            'px;' +
            'text-align: ' +
            (i === 0 ? 'left' : 'center') +
            '; ' +
            'min-width: ' +
            minWidth +
            'px;' +
            'left: ' +
            (isLast ? width + 'px' : 'unset') +
            ';"' +
            '>' +
            lengthString +
            '</div>');
    };
    /**
     * Returns the appropriate scale for the given resolution and units.
     * @return {number} The appropriate scale.
     */
    ScaleLine.prototype.getScaleForResolution = function () {
        var resolution = getPointResolution(this.viewState_.projection, this.viewState_.resolution, this.viewState_.center, ProjUnits.METERS);
        var dpi = this.dpi_ || DEFAULT_DPI;
        var inchesPerMeter = 1000 / 25.4;
        return parseFloat(resolution.toString()) * inchesPerMeter * dpi;
    };
    /**
     * Update the scale line element.
     * @param {import("../MapEvent.js").default} mapEvent Map event.
     * @override
     */
    ScaleLine.prototype.render = function (mapEvent) {
        var frameState = mapEvent.frameState;
        if (!frameState) {
            this.viewState_ = null;
        }
        else {
            this.viewState_ = frameState.viewState;
        }
        this.updateElement_();
    };
    return ScaleLine;
}(Control));
export default ScaleLine;
//# sourceMappingURL=ScaleLine.js.map