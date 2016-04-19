var _ = require('lodash');
var $ = require('jquery');
var moment = require('moment');

require('flot');
require('flotTime');
require('flotCrosshair');
require('flotCanvas');
require('flotSelection');
require('flotSymbol');

var app = require('ui/modules').get('apps/timelion', []);
var template = '<div class="chart-title"></div><div class="chart-canvas"></div>';

app.directive('chart', function ($compile, $rootScope, timefilter, $timeout, Private) {
  return {
    restrict: 'A',
    scope: {
      chart: '=', // The flot object, data, config and all
      search: '=' // The function to execute to kick off a search
    },
    link: function ($scope, $elem) {
      var timezone = Private(require('plugins/timelion/services/timezone'))();
      var tickFormatters = require('plugins/timelion/services/tick_formatters')();

      $scope.search = $scope.search || _.noop;

      var legendValueNumbers;
      var debouncedSetLegendNumbers;
      var defaultOptions = {
        canvas: true,
        xaxis: {
          mode: 'time',
          tickLength: 0,
          timezone: 'browser'
        },
        selection: {
          mode: 'x',
          color: '#ccc'
        },
        crosshair: {
          mode: 'x',
          color: '#C66',
          lineWidth: 2
        },
        grid: {
          backgroundColor: '#FFF',
          borderWidth: 0,
          borderColor: null,
          margin: 10,
          hoverable: true,
          autoHighlight: false
        },
        legend: {
          position: 'nw',
          labelBoxBorderColor: 'rgb(255,255,255,0)',
          labelFormatter: function (label, series) {
            return '<span class="ngLegendValue" ng-click="toggleSeries(' + series._id + ')">' +
              label +
              '<span class="ngLegendValueNumber"></span></span>';
          }
        },
        yaxes: [ {}, { position: 'right' } ],
        colors: ['#01A4A4', '#C66', '#D0D102', '#616161', '#00A1CB', '#32742C', '#F18D05', '#113F8C', '#61AE24', '#D70060']
      };


      $scope.toggleSeries = function (id) {
        var series = $scope.chart[id];
        series._hide = !series._hide;
        drawPlot($scope.chart);
      };

      $(window).resize(function () {
        if (!$scope.plot) return;
        console.log('redrawing');
        $timeout(function () {
          // This is a lot faster than calling drawPlot(); Stolen from the borked flot.resize plugin
          // TODO: Currently resizing breaks tooltips
          $scope.plot.resize();
          $scope.plot.setupGrid();
          $scope.plot.draw();
        }, 0);
      });

      $scope.$on('$destroy', function () {
        $(window).off('resize'); //remove the handler added earlier
        $elem.off('plothover');
        $elem.off('plotselected');
        $elem.off('mouseleave');
      });

      $elem.on('plothover',  function (event, pos, item) {
        $rootScope.$broadcast('timelionPlotHover', event, pos, item);
      });

      $elem.on('plotselected', function (event, ranges) {
        timefilter.time.from = moment(ranges.xaxis.from);
        timefilter.time.to = moment(ranges.xaxis.to);
        timefilter.time.mode = 'absolute';
        $scope.search();
      });

      $elem.on('mouseleave', function () {
        $rootScope.$broadcast('timelionPlotLeave');
      });

      $scope.$on('timelionPlotHover', function (angularEvent, flotEvent, pos, time) {
        $scope.plot.setCrosshair(pos);
        debouncedSetLegendNumbers(pos);
      });

      $scope.$on('timelionPlotLeave', function (angularEvent, flotEvent, pos, time) {
        $scope.plot.clearCrosshair();
        clearLegendNumbers();
      });

      var debounceDelay = 50;
      debouncedSetLegendNumbers = _.debounce(setLegendNumbers, debounceDelay, {
        maxWait: debounceDelay,
        leading: true,
        trailing: false
      });

      // Shamelessly borrowed from the flotCrosshairs example
      function setLegendNumbers(pos) {
        var plot = $scope.plot;

        var axes = plot.getAxes();
        if (pos.x < axes.xaxis.min || pos.x > axes.xaxis.max) {
          return;
        }

        var i;
        var j;
        var dataset = plot.getData();
        for (i = 0; i < dataset.length; ++i) {

          var series = dataset[i];
          var precision = _.get(series, '_meta.precision', 2);

          if (series._hide) continue;

          // Nearest point
          for (j = 0; j < series.data.length; ++j) {
            if (series.data[j][0] > pos.x) break;
          }

          var y;
          try {
            y = series.data[j][1];
          } catch (e) {
            y = null;
          }

          if (y != null) {
            var valueLabel = series.valueFormat
              .replace('%x',pos.x)
              .replace('%X',series.xaxis.tickFormatter(pos.x,series.xaxis))
              .replace('%y',y.toFixed(precision))
              .replace('%Y',series.yaxis.tickFormatter(y.toFixed(precision),series.yaxis));
            legendValueNumbers.eq(i).text(valueLabel);
          } else {
            legendValueNumbers.eq(i).empty();
          }
        }
      }

      function clearLegendNumbers() {
        _.each(legendValueNumbers, function (num) {
          $(num).empty();
        });
      }

      var legendScope = $scope.$new();
      function drawPlot(plotConfig) {

        if (!plotConfig || !plotConfig.length) {
          $elem.empty();
          return;
        }

        if (!$('.chart-canvas', $elem).length) $elem.html(template);
        var canvasElem = $('.chart-canvas', $elem);

        var title = _(plotConfig).map('_title').compact().last();
        $('.chart-title', $elem).text(title == null ? '' : title);

        var options = _.cloneDeep(defaultOptions);
        var series = _.map(plotConfig, function (series, index) {
          series = _.cloneDeep(_.defaults(series, {
            shadowSize: 0,
            lines: {
              lineWidth: 3
            }
          }));
          series._id = index;

          if (series._hide) {
            series.data = [];
            //series.color = "#ddd";
            series.label = '(hidden) ' + series.label;
          }

          console.log('options:',options);
          console.log('series:',series);
        //  _.merge(options, series._);
          if (series._global) {
            _.merge(options, series._global);

            _.forEach(options.yaxes, function (yaxis) {
              if (yaxis && yaxis._units !== undefined && tickFormatters[yaxis._units[0]] !== undefined) {
                yaxis.tickFormatter = tickFormatters[yaxis._units[0]];
              }
            });
          }

          return series;
        });

        $scope.plot = $.plot(canvasElem, _.compact(series), options);

        legendScope.$destroy();
        legendScope = $scope.$new();
        // Used to toggle the series, and for displaying values on hover
        legendValueNumbers = canvasElem.find('.ngLegendValueNumber');
        _.each(canvasElem.find('.ngLegendValue'), function (elem) {
          $compile(elem)(legendScope);
        });
      }

      $scope.$watch('chart', drawPlot);
    }
  };
});
